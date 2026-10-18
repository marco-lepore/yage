import { ErrorBoundary, Logger } from "@yagejs/core";
import type { CallbackErrorInfo } from "@yagejs/core";
import type {
  BehaviorAction,
  BehaviorCancelReason,
  BehaviorError,
  BehaviorExit,
  BehaviorInspection,
  BehaviorNode,
  BehaviorNodeStatus,
  BehaviorStatus,
  BehaviorTransition,
  BehaviorTreeOptions,
} from "./types.js";

interface Frame<C> {
  definition: BehaviorNode<C>;
  path: string;
  children: Frame<C>[];
  status: BehaviorNodeStatus;
  cursor: number;
  elapsed: number;
  action: BehaviorAction | undefined;
}

const CANCEL_TICK = Symbol("cancel behavior tick");

function duration(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name}: expected finite seconds >= 0, got ${value}`);
  }
}

/** One independently driven execution of a reusable definition. */
export class BehaviorTree<C> {
  private readonly root: Frame<C>;
  private readonly frames: Frame<C>[] = [];
  private readonly history: BehaviorTransition[] = [];
  private readonly historyLimit: number;
  private boundary: ErrorBoundary;
  private owner: Pick<CallbackErrorInfo, "entity" | "scene"> = {};
  private ownerToken: object | undefined;
  private tickNumber = 0;
  private busy = false;
  private pendingCancel: BehaviorCancelReason | null = null;
  private error: BehaviorError | null = null;

  constructor(
    definition: BehaviorNode<C>,
    private readonly context: C,
    options: BehaviorTreeOptions = {},
  ) {
    this.historyLimit = options.historyLimit ?? 128;
    if (
      !Number.isInteger(this.historyLimit) ||
      this.historyLimit < 0 ||
      this.historyLimit > 10000
    ) {
      throw new Error(
        `BehaviorTree: historyLimit must be an integer in [0, 10000], got ${this.historyLimit}`,
      );
    }
    this.boundary = options.errorBoundary ?? new ErrorBoundary(new Logger());
    this.root = this.compile(definition, "", new Set());
  }

  get status(): BehaviorNodeStatus {
    return this.root.status;
  }

  /**
   * Run one traversal. A completed root restarts on the next positive tick.
   * dt=0 freezes execution. Time left after a child finishes is discarded.
   */
  tick(dt: number): BehaviorNodeStatus {
    duration(dt, "BehaviorTree.tick");
    if (this.busy)
      throw new Error("BehaviorTree.tick: cannot tick during a callback");
    if (dt === 0) return this.status;
    this.busy = true;
    try {
      this.tickNumber++;
      if (this.status === "success" || this.status === "failure")
        this.reset(this.root, "restart");
      this.visit(this.root, dt);
      this.checkCancellation();
    } catch (error) {
      if (error !== CANCEL_TICK) throw error;
      const reason = this.pendingCancel ?? "cancelled";
      this.pendingCancel = null;
      this.halt(this.root, reason, null);
    } finally {
      this.busy = false;
      this.pendingCancel = null;
    }
    return this.status;
  }

  /** Exit running work and return to idle. The next tick starts at the root. */
  cancel(reason: BehaviorCancelReason = "cancelled"): void {
    if (this.busy) {
      this.pendingCancel = reason;
      return;
    }
    this.busy = true;
    try {
      this.halt(this.root, reason, null);
    } finally {
      this.busy = false;
      this.pendingCancel = null;
    }
  }

  /** Copies diagnostics only. Context and action closures never enter the result. */
  inspect(): BehaviorInspection {
    return {
      status: this.status,
      tick: this.tickNumber,
      activePaths: this.frames
        .filter((frame) => frame.status === "running")
        .map((frame) => frame.path),
      nodes: this.frames.map((frame) => ({
        path: frame.path,
        id: frame.definition.id,
        kind: frame.definition.kind,
        status: frame.status,
      })),
      transitions: this.history.map((transition) => ({ ...transition })),
      lastError: this.error ? { ...this.error } : null,
    };
  }

  /** Bind a custom host's existing error boundary. One runner has one owner. */
  bindOwner(
    token: object,
    boundary: ErrorBoundary,
    owner: Pick<CallbackErrorInfo, "entity" | "scene"> = {},
  ): void {
    if (this.busy || (this.ownerToken && this.ownerToken !== token)) {
      throw new Error(
        "BehaviorTree.bindOwner: runner already owned or executing; create a runner per entity",
      );
    }
    this.ownerToken = token;
    this.boundary = boundary;
    this.owner = { ...owner };
  }

  private compile(
    definition: BehaviorNode<C>,
    parent: string,
    ancestors: Set<BehaviorNode<C>>,
  ): Frame<C> {
    if (ancestors.has(definition))
      throw new Error(`BehaviorTree: cyclic definition at ${parent}`);
    if (ancestors.size >= 128 || this.frames.length >= 4096)
      throw new Error(
        "BehaviorTree: maximum depth 128 or node count 4096 exceeded",
      );
    if (!definition.id || definition.id.includes("/"))
      throw new Error(
        `BehaviorTree: node id must be nonempty without '/', got ${definition.id}`,
      );
    const path = parent ? `${parent}/${definition.id}` : definition.id;
    const copy = { ...definition };
    const frame: Frame<C> = {
      definition: copy,
      path,
      children: [],
      status: "idle",
      cursor: 0,
      elapsed: 0,
      action: undefined,
    };
    this.frames.push(frame);
    ancestors.add(definition);
    let children: readonly BehaviorNode<C>[] = [];
    switch (copy.kind) {
      case "action":
        if (typeof copy.create !== "function")
          throw new Error(`BehaviorTree: ${path} requires create(context)`);
        break;
      case "condition":
      case "guard":
        if (typeof copy.test !== "function")
          throw new Error(`BehaviorTree: ${path} requires test(context)`);
        if (copy.kind === "guard") children = [copy.child];
        break;
      case "sequence":
      case "selector":
        if (copy.reactive !== undefined && typeof copy.reactive !== "boolean")
          throw new Error(`BehaviorTree: ${path} reactive must be boolean`);
        children = copy.children;
        break;
      case "wait":
        duration(copy.seconds, `BehaviorTree ${path}`);
        break;
      case "timeout":
        duration(copy.seconds, `BehaviorTree ${path}`);
        children = [copy.child];
        break;
      case "subtree":
      case "invert":
        children = [copy.child];
        break;
      default:
        throw new Error(`BehaviorTree: unknown node kind at ${path}`);
    }
    const ids = new Set<string>();
    for (const child of children) {
      if (ids.has(child.id))
        throw new Error(
          `BehaviorTree: duplicate sibling id ${path}/${child.id}`,
        );
      ids.add(child.id);
      frame.children.push(this.compile(child, path, ancestors));
    }
    ancestors.delete(definition);
    return frame;
  }

  private invoke<T>(frame: Frame<C>, phase: string, call: () => T): T {
    let result!: T;
    try {
      this.boundary.wrapCallback(
        () => {
          result = call();
          // Lifecycle hooks are typed void, which TypeScript also accepts for async functions.
          if (
            result &&
            typeof (result as { then?: unknown }).then === "function"
          ) {
            throw new Error(
              `BehaviorTree ${frame.path}.${phase}: callbacks must be synchronous`,
            );
          }
        },
        { kind: `Behavior tree ${phase}`, event: frame.path, ...this.owner },
      );
    } catch (error) {
      this.error = {
        tick: this.tickNumber,
        path: frame.path,
        phase,
        message: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
    if (phase !== "exit" && phase !== "create") this.checkCancellation();
    return result;
  }

  private checkCancellation(): void {
    if (this.pendingCancel) throw CANCEL_TICK;
  }

  private visit(frame: Frame<C>, dt: number): BehaviorStatus {
    const node = frame.definition;
    if (frame.status === "success" || frame.status === "failure")
      this.reset(frame, "reevaluate");
    const entering = frame.status === "idle";
    if (entering && (node.kind === "action" || node.kind === "wait"))
      this.haltOutside(this.root, frame.path);
    this.checkCancellation();
    this.change(frame, "running", "enter");
    let result: BehaviorStatus;
    switch (node.kind) {
      case "action": {
        if (entering) {
          frame.action = this.invoke(frame, "create", () => {
            const action = node.create(this.context);
            if (!action || typeof action.tick !== "function")
              throw new Error(
                `BehaviorTree ${frame.path}: create must return an action with tick(dt)`,
              );
            return action;
          });
          this.checkCancellation();
          if (frame.action.enter)
            this.invoke(frame, "enter", () => frame.action!.enter!());
        }
        const action = frame.action;
        if (!action)
          throw new Error(
            `BehaviorTree ${frame.path}: action exit failed; cancel before ticking again`,
          );
        result = this.invoke(frame, "tick", () => {
          const status = action.tick(dt);
          if (
            status !== "running" &&
            status !== "success" &&
            status !== "failure"
          )
            throw new Error(
              `BehaviorTree ${frame.path}.tick: expected running, success or failure, got ${String(status)}`,
            );
          return status;
        });
        if (result !== "running") this.exit(frame, { status: result });
        break;
      }
      case "condition":
        result = this.test(frame, node.test) ? "success" : "failure";
        break;
      case "guard":
        if (!this.test(frame, node.test)) {
          this.halt(frame.children[0]!, "guard-failed", frame.path);
          result = "failure";
        } else result = this.visit(frame.children[0]!, dt);
        break;
      case "sequence":
      case "selector": {
        const advance = node.kind === "sequence" ? "success" : "failure";
        result = advance;
        const start = node.reactive ? 0 : frame.cursor;
        for (let i = start; i < frame.children.length; i++) {
          result = this.visit(frame.children[i]!, dt);
          if (result !== advance) {
            frame.cursor = i;
            for (let j = i + 1; j < frame.children.length; j++) {
              if (frame.children[j]!.status === "running")
                this.halt(
                  frame.children[j]!,
                  "branch-changed",
                  frame.children[i]!.path,
                );
            }
            break;
          }
        }
        break;
      }
      case "wait":
        frame.elapsed = Math.min(node.seconds, frame.elapsed + dt);
        result = frame.elapsed >= node.seconds ? "success" : "running";
        break;
      case "timeout":
        frame.elapsed = Math.min(node.seconds, frame.elapsed + dt);
        if (frame.elapsed >= node.seconds) {
          this.halt(frame.children[0]!, "timeout", frame.path);
          result = "failure";
        } else result = this.visit(frame.children[0]!, dt);
        break;
      case "subtree":
        result = this.visit(frame.children[0]!, dt);
        break;
      case "invert": {
        const childResult = this.visit(frame.children[0]!, dt);
        result =
          childResult === "running"
            ? "running"
            : childResult === "success"
              ? "failure"
              : "success";
        break;
      }
    }
    this.checkCancellation();
    this.change(frame, result, result);
    return result;
  }

  private test(frame: Frame<C>, test: (context: C) => boolean): boolean {
    return this.invoke(frame, "condition", () => {
      const result = test(this.context);
      if (typeof result !== "boolean")
        throw new Error(
          `BehaviorTree ${frame.path}: condition must return boolean`,
        );
      return result;
    });
  }

  private exit(frame: Frame<C>, reason: BehaviorExit): void {
    const action = frame.action;
    frame.action = undefined;
    if (action?.exit) this.invoke(frame, "exit", () => action.exit!(reason));
  }

  private haltOutside(frame: Frame<C>, next: string): void {
    if (frame.path === next) return;
    if (next.startsWith(`${frame.path}/`)) {
      for (const child of frame.children) this.haltOutside(child, next);
    } else if (frame.status === "running")
      this.halt(frame, "branch-changed", next);
  }

  private halt(
    frame: Frame<C>,
    reason: BehaviorCancelReason,
    by: string | null,
  ): void {
    for (const child of frame.children) this.halt(child, reason, by);
    if (frame.action) this.exit(frame, { status: "cancelled", reason, by });
    this.resetFrame(frame, reason, by);
  }

  private reset(frame: Frame<C>, reason: string): void {
    for (const child of frame.children) this.reset(child, reason);
    this.resetFrame(frame, reason, null);
  }

  private resetFrame(frame: Frame<C>, reason: string, by: string | null): void {
    frame.cursor = 0;
    frame.elapsed = 0;
    frame.action = undefined;
    this.change(frame, "idle", reason, by);
  }

  private change(
    frame: Frame<C>,
    to: BehaviorNodeStatus,
    reason: string,
    by: string | null = null,
  ): void {
    if (frame.status === to) return;
    if (this.historyLimit > 0) {
      this.history.push({
        tick: this.tickNumber,
        path: frame.path,
        from: frame.status,
        to,
        reason,
        by,
      });
      if (this.history.length > this.historyLimit) this.history.shift();
    }
    frame.status = to;
  }
}
