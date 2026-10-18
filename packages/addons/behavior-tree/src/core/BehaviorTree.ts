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
  BehaviorNumber,
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
  duration: number | null;
  accepted: boolean | null;
  weights: number[] | undefined;
  cooldownRemaining: number;
  action: BehaviorAction | undefined;
}

const CANCEL_TICK = Symbol("cancel behavior tick");

function duration(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name}: expected finite seconds >= 0, got ${value}`);
  }
}

function numeric(value: number, name: string, max = Number.MAX_VALUE): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    const constraint = max === Number.MAX_VALUE ? ">= 0" : `in [0, ${max}]`;
    throw new Error(
      `${name}: expected finite number ${constraint}, got ${value}`,
    );
  }
  return value;
}

function validateValue<C>(
  value: BehaviorNumber<C>,
  name: string,
  max?: number,
): void {
  if (typeof value !== "function") numeric(value, name, max);
}

/** One independently driven execution of a reusable definition. */
export class BehaviorTree<C> {
  private readonly root: Frame<C>;
  private readonly frames: Frame<C>[] = [];
  private readonly history: BehaviorTransition[] = [];
  private readonly historyLimit: number;
  private boundary: ErrorBoundary;
  private random: (() => number) | undefined;
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
    if (options.random !== undefined && typeof options.random !== "function")
      throw new Error("BehaviorTree: random must be a function");
    this.random = options.random;
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
      for (const frame of this.frames) {
        frame.cooldownRemaining = Math.max(0, frame.cooldownRemaining - dt);
      }
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
        durationSeconds: frame.duration,
        remainingSeconds:
          frame.definition.kind === "cooldown"
            ? frame.cooldownRemaining
            : frame.duration === null
              ? null
              : Math.max(0, frame.duration - frame.elapsed),
        chancePassed: frame.accepted,
        selectedChild:
          frame.definition.kind === "weightedSelector" && frame.weights
            ? (frame.children[frame.cursor]?.path ?? null)
            : null,
        remainingWeights: frame.weights ? [...frame.weights] : null,
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
    random?: () => number,
  ): void {
    if (this.busy || (this.ownerToken && this.ownerToken !== token)) {
      throw new Error(
        "BehaviorTree.bindOwner: runner already owned or executing; create a runner per entity",
      );
    }
    this.ownerToken = token;
    this.boundary = boundary;
    this.owner = { ...owner };
    this.random ??= random;
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
      duration: null,
      accepted: null,
      weights: undefined,
      cooldownRemaining: 0,
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
        validateValue(copy.seconds, `BehaviorTree ${path}.seconds`);
        break;
      case "timeout":
      case "cooldown":
        validateValue(copy.seconds, `BehaviorTree ${path}.seconds`);
        children = [copy.child];
        break;
      case "randomWait":
        validateValue(copy.min, `BehaviorTree ${path}.min`);
        validateValue(copy.max, `BehaviorTree ${path}.max`);
        if (
          typeof copy.min === "number" &&
          typeof copy.max === "number" &&
          copy.min > copy.max
        )
          throw new Error(`BehaviorTree ${path}: min must be <= max`);
        break;
      case "chance":
        validateValue(copy.probability, `BehaviorTree ${path}.probability`, 1);
        children = [copy.child];
        break;
      case "weightedSelector":
        if (
          copy.onFailure !== undefined &&
          copy.onFailure !== "retry" &&
          copy.onFailure !== "fail"
        )
          throw new Error(
            `BehaviorTree ${path}: onFailure must be retry or fail`,
          );
        copy.choices = copy.choices.map((choice) => ({ ...choice }));
        for (const choice of copy.choices)
          validateValue(
            choice.weight,
            `BehaviorTree ${path}/${choice.child.id}.weight`,
          );
        children = copy.choices.map((choice) => choice.child);
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

  private value(
    frame: Frame<C>,
    value: BehaviorNumber<C>,
    phase: string,
    max?: number,
  ): number {
    if (typeof value === "number") return value;
    return this.invoke(frame, phase, () =>
      numeric(value(this.context), `BehaviorTree ${frame.path}.${phase}`, max),
    );
  }

  private roll(frame: Frame<C>): number {
    return this.invoke(frame, "random", () => {
      if (!this.random)
        throw new Error(
          `BehaviorTree ${frame.path}: supply options.random or mount a BehaviorTreeAgent before using random nodes`,
        );
      const value = this.random();
      if (!Number.isFinite(value) || value < 0 || value >= 1)
        throw new Error(
          `BehaviorTree ${frame.path}.random: expected finite number in [0, 1), got ${value}`,
        );
      return value;
    });
  }

  private choose(frame: Frame<C>): number {
    const weights = frame.weights!;
    const scale = Math.max(0, ...weights);
    if (scale === 0) return -1;
    // Scale before summing so several legal, large weights cannot overflow.
    const total = weights.reduce((sum, weight) => sum + weight / scale, 0);
    const target = this.roll(frame) * total;
    let cumulative = 0;
    let last = -1;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i]! === 0) continue;
      last = i;
      cumulative += weights[i]! / scale;
      if (target < cumulative) return i;
    }
    return last;
  }

  private visit(frame: Frame<C>, dt: number): BehaviorStatus {
    const node = frame.definition;
    if (frame.status === "success" || frame.status === "failure")
      this.reset(frame, "reevaluate");
    const entering = frame.status === "idle";
    if (
      entering &&
      (node.kind === "action" ||
        node.kind === "wait" ||
        node.kind === "randomWait")
    )
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
      case "randomWait":
        if (entering) {
          if (node.kind === "wait")
            frame.duration = this.value(frame, node.seconds, "duration");
          else {
            const min = this.value(frame, node.min, "minimum");
            const max = this.value(frame, node.max, "maximum");
            this.invoke(frame, "duration", () => {
              if (min > max)
                throw new Error(
                  `BehaviorTree ${frame.path}: min must be <= max, got ${min}, ${max}`,
                );
            });
            frame.duration =
              min === max ? min : min + this.roll(frame) * (max - min);
          }
        }
        frame.elapsed = Math.min(frame.duration!, frame.elapsed + dt);
        result = frame.elapsed >= frame.duration! ? "success" : "running";
        break;
      case "timeout":
        if (entering)
          frame.duration = this.value(frame, node.seconds, "duration");
        frame.elapsed = Math.min(frame.duration!, frame.elapsed + dt);
        if (frame.elapsed >= frame.duration!) {
          this.halt(frame.children[0]!, "timeout", frame.path);
          result = "failure";
        } else result = this.visit(frame.children[0]!, dt);
        break;
      case "cooldown":
        if (entering && frame.cooldownRemaining > 0) result = "failure";
        else {
          if (entering)
            frame.duration = this.value(frame, node.seconds, "duration");
          result = this.visit(frame.children[0]!, dt);
          if (result === "success") frame.cooldownRemaining = frame.duration!;
        }
        break;
      case "chance":
        if (entering) {
          const probability = this.value(
            frame,
            node.probability,
            "probability",
            1,
          );
          frame.accepted =
            probability === 1 ||
            (probability > 0 && this.roll(frame) < probability);
        }
        result = frame.accepted
          ? this.visit(frame.children[0]!, dt)
          : "failure";
        break;
      case "weightedSelector":
        if (entering) {
          frame.weights = node.choices.map((choice) =>
            this.value(frame, choice.weight, "weight"),
          );
          frame.cursor = this.choose(frame);
        }
        result = "failure";
        while (frame.cursor !== -1) {
          result = this.visit(frame.children[frame.cursor]!, dt);
          if (result !== "failure" || node.onFailure === "fail") break;
          frame.weights![frame.cursor] = 0;
          frame.cursor = this.choose(frame);
        }
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
    frame.duration = null;
    frame.accepted = null;
    frame.weights = undefined;
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
