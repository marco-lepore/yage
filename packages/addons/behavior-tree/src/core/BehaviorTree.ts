import { ErrorBoundary, Logger } from "@yagejs/core";
import type { CallbackErrorInfo } from "@yagejs/core";
import { assertSynchronous } from "./sync.js";
import type {
  BehaviorAction,
  BehaviorCallbackPhase,
  BehaviorCancelReason,
  BehaviorError,
  BehaviorExit,
  BehaviorInspection,
  BehaviorNode,
  BehaviorNodeStatus,
  BehaviorNumber,
  BehaviorStatus,
  BehaviorTransition,
  BehaviorTransitionReason,
  BehaviorTreeOptions,
  BehaviorTreeSnapshot,
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
  count: number;
  limit: number | null;
  cooldownRemaining: number;
  action: BehaviorAction | undefined;
}

type Check = (value: number, label: string) => number;

const CANCEL_TICK = Symbol("cancel behavior tick");

const nonnegative: Check = (value, label) => {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label}: expected finite number >= 0, got ${value}`);
  return value;
};

const probability: Check = (value, label) => {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${label}: expected finite number in [0, 1], got ${value}`);
  return value;
};

const count: Check = (value, label) => {
  if (value !== Infinity && !(Number.isInteger(value) && value >= 0))
    throw new Error(
      `${label}: expected integer >= 0 or Infinity, got ${value}`,
    );
  return value;
};

function check<C>(value: BehaviorNumber<C>, label: string, valid: Check): void {
  if (typeof value === "number") valid(value, label);
}

function childrenOf<C>(node: BehaviorNode<C>): readonly BehaviorNode<C>[] {
  switch (node.kind) {
    case "action":
    case "condition":
    case "wait":
    case "randomWait":
      return [];
    case "sequence":
    case "selector":
    case "parallel":
      return node.children;
    case "weightedSelector":
      return node.choices.map((choice) => choice.child);
    default:
      return [node.child];
  }
}

/** Constant certain chances and equal wait bounds never draw. */
function drawsRandom<C>(node: BehaviorNode<C>): boolean {
  switch (node.kind) {
    case "chance":
      return (
        typeof node.probability !== "number" ||
        (node.probability > 0 && node.probability < 1)
      );
    case "randomWait":
      return typeof node.min !== "number" || node.min !== node.max;
    case "weightedSelector":
      return true;
    default:
      return false;
  }
}

/** One independently driven execution of a reusable definition. */
export class BehaviorTree<C> {
  private readonly root: Frame<C>;
  private readonly frames: Frame<C>[] = [];
  private readonly cooldowns: Frame<C>[] = [];
  private readonly history: BehaviorTransition[] = [];
  private readonly historyLimit: number;
  private readonly boundary: ErrorBoundary;
  private readonly random: (() => number) | undefined;
  private readonly owner: Pick<CallbackErrorInfo, "entity" | "scene">;
  private tickNumber = 0;
  private busy = false;
  private pendingCancel: BehaviorCancelReason | null = null;
  private error: BehaviorError | null = null;
  /** The callback error that halted execution; cleared by a completed cancel(). */
  private fault: BehaviorError | null = null;

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
    this.random = options.random;
    this.owner = { ...options.owner };
    this.root = this.compile(definition, "", new Set());
    const random = this.frames.find((frame) => drawsRandom(frame.definition));
    if (random && !this.random)
      throw new Error(
        `BehaviorTree: ${random.path} draws random numbers; pass options.random or mount the tree with a BehaviorTreeAgent`,
      );
  }

  get status(): BehaviorNodeStatus {
    return this.root.status;
  }

  /**
   * Run one traversal. A completed root restarts on the next positive tick.
   * dt=0 freezes execution. Time left after a child finishes is discarded.
   */
  tick(dt: number): BehaviorNodeStatus {
    nonnegative(dt, "BehaviorTree.tick");
    if (this.busy)
      throw new Error("BehaviorTree.tick: cannot tick during a callback");
    if (this.fault) {
      const { path, phase, tick } = this.fault;
      throw new Error(
        `BehaviorTree.tick: ${path}.${phase} threw on tick ${tick}; call cancel() before ticking again`,
      );
    }
    if (dt === 0) return this.status;
    this.busy = true;
    try {
      this.tickNumber++;
      for (const frame of this.cooldowns) {
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

  /**
   * Exit running work and return to idle. The next tick starts at the root.
   * Also clears a callback failure, so ticking can resume.
   */
  cancel(reason: BehaviorCancelReason = "cancelled"): void {
    if (this.busy) {
      this.pendingCancel = reason;
      return;
    }
    this.busy = true;
    try {
      this.halt(this.root, reason, null);
      this.fault = null;
    } finally {
      this.busy = false;
      this.pendingCancel = null;
    }
  }

  /** Armed cooldowns: the only progress that survives cancel(). */
  snapshot(): BehaviorTreeSnapshot {
    // fromEntries defines own keys, so a root id such as "__proto__" is kept.
    return {
      cooldowns: Object.fromEntries(
        this.cooldowns
          .filter((frame) => frame.cooldownRemaining > 0)
          .map((frame) => [frame.path, frame.cooldownRemaining]),
      ),
    };
  }

  /**
   * Cancel running work, then replace every cooldown with the snapshot's
   * value. Paths the tree does not have are dropped, and cooldowns missing
   * from the snapshot start available. Throws before cancelling anything when
   * a known path holds a value that is not a finite number >= 0.
   */
  restore(snapshot: BehaviorTreeSnapshot): void {
    const cooldowns: unknown = snapshot?.cooldowns;
    if (
      typeof cooldowns !== "object" ||
      cooldowns === null ||
      Array.isArray(cooldowns)
    )
      throw new Error(
        "BehaviorTree.restore: snapshot.cooldowns must be a plain object",
      );
    if (this.busy)
      throw new Error("BehaviorTree.restore: cannot restore during a callback");
    const restored = this.cooldowns.map((frame) => {
      if (!Object.hasOwn(cooldowns, frame.path)) return [frame, 0] as const;
      const value: unknown = (cooldowns as Record<string, unknown>)[frame.path];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error(
          `BehaviorTree.restore: cooldowns["${frame.path}"] must be a finite number >= 0, got ${String(value)}`,
        );
      return [frame, value] as const;
    });
    this.cancel();
    for (const [frame, value] of restored) frame.cooldownRemaining = value;
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
        count: frame.limit === null ? null : frame.count,
        limit: frame.limit,
      })),
      transitions: this.history.map((transition) => ({ ...transition })),
      lastError: this.error ? { ...this.error } : null,
    };
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
    const label = `BehaviorTree ${path}`;
    const copy = { ...definition };
    switch (copy.kind) {
      case "wait":
      case "timeout":
      case "cooldown":
        check(copy.seconds, `${label}.seconds`, nonnegative);
        break;
      case "randomWait":
        check(copy.min, `${label}.min`, nonnegative);
        check(copy.max, `${label}.max`, nonnegative);
        if (
          typeof copy.min === "number" &&
          typeof copy.max === "number" &&
          copy.min > copy.max
        )
          throw new Error(`${label}: min must be <= max`);
        break;
      case "chance":
        check(copy.probability, `${label}.probability`, probability);
        break;
      case "repeat":
        check(copy.times, `${label}.times`, count);
        break;
      case "retry":
        check(copy.attempts, `${label}.attempts`, count);
        break;
      case "weightedSelector":
        copy.choices = copy.choices.map((choice) => ({ ...choice }));
        for (const choice of copy.choices)
          check(
            choice.weight,
            `${label}/${choice.child.id}.weight`,
            nonnegative,
          );
        break;
    }
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
      count: 0,
      limit: null,
      cooldownRemaining: 0,
      action: undefined,
    };
    this.frames.push(frame);
    if (copy.kind === "cooldown") this.cooldowns.push(frame);
    ancestors.add(definition);
    const ids = new Set<string>();
    for (const child of childrenOf(copy)) {
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

  private invoke<T>(
    frame: Frame<C>,
    phase: BehaviorCallbackPhase,
    call: () => T,
  ): T {
    let result!: T;
    try {
      this.boundary.wrapCallback(
        () => {
          result = call();
          assertSynchronous(result, `BehaviorTree ${frame.path}.${phase}`);
        },
        { kind: `Behavior tree ${phase}`, event: frame.path, ...this.owner },
      );
    } catch (error) {
      this.error = this.fault = {
        tick: this.tickNumber,
        path: frame.path,
        phase,
        message: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
    if (phase !== "exit") this.checkCancellation();
    return result;
  }

  private checkCancellation(): void {
    if (this.pendingCancel) throw CANCEL_TICK;
  }

  private value(
    frame: Frame<C>,
    value: BehaviorNumber<C>,
    phase: BehaviorCallbackPhase,
    valid: Check,
  ): number {
    if (typeof value === "number") return value;
    return this.invoke(frame, phase, () =>
      valid(value(this.context), `BehaviorTree ${frame.path}.${phase}`),
    );
  }

  private roll(frame: Frame<C>): number {
    return this.invoke(frame, "random", () => {
      const value = this.random!();
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
          // A cancel requested by `create` ends the tick before the action is
          // stored, so an action that never entered never exits.
          const created = this.invoke(frame, "create", () =>
            node.create(this.context),
          );
          frame.action = created;
          if (created.enter)
            this.invoke(frame, "enter", () => created.enter!());
        }
        const action = frame.action!;
        result = this.invoke(frame, "tick", () => action.tick(dt));
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
      case "parallel": {
        const decisive = node.success === "any" ? "success" : "failure";
        let decider: Frame<C> | undefined;
        let running = false;
        for (const child of frame.children) {
          // A child that finished this activation keeps its result.
          const status =
            child.status === "success" || child.status === "failure"
              ? child.status
              : this.visit(child, dt);
          if (status === decisive) {
            decider = child;
            break;
          }
          if (status === "running") running = true;
        }
        if (decider) {
          for (const child of frame.children) {
            if (child.status === "running")
              this.halt(child, "branch-changed", decider.path);
          }
          result = decisive;
        } else if (running) result = "running";
        else result = decisive === "success" ? "failure" : "success";
        break;
      }
      case "wait":
      case "randomWait":
        if (entering) {
          if (node.kind === "wait")
            frame.duration = this.value(
              frame,
              node.seconds,
              "seconds",
              nonnegative,
            );
          else {
            const min = this.value(frame, node.min, "min", nonnegative);
            const max = this.value(frame, node.max, "max", nonnegative);
            this.invoke(frame, "max", () => {
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
          frame.duration = this.value(
            frame,
            node.seconds,
            "seconds",
            nonnegative,
          );
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
            frame.duration = this.value(
              frame,
              node.seconds,
              "seconds",
              nonnegative,
            );
          result = this.visit(frame.children[0]!, dt);
          if (result === "success") frame.cooldownRemaining = frame.duration!;
        }
        break;
      case "chance":
        if (entering) {
          const chance = this.value(
            frame,
            node.probability,
            "probability",
            probability,
          );
          frame.accepted =
            chance === 1 || (chance > 0 && this.roll(frame) < chance);
        }
        result = frame.accepted
          ? this.visit(frame.children[0]!, dt)
          : "failure";
        break;
      case "repeat":
      case "retry": {
        // Repeat counts child successes, retry counts failures. Each further
        // run starts on the next tick, so an instant child cannot loop.
        const again = node.kind === "repeat" ? "success" : "failure";
        if (entering) {
          frame.limit =
            node.kind === "repeat"
              ? this.value(frame, node.times, "times", count)
              : this.value(frame, node.attempts, "attempts", count);
          frame.count = 0;
        }
        if (frame.count >= frame.limit!) {
          result = again;
          break;
        }
        result = this.visit(frame.children[0]!, dt);
        if (result === again && ++frame.count < frame.limit!)
          result = "running";
        break;
      }
      case "weightedSelector":
        if (entering) {
          frame.weights = node.choices.map((choice) =>
            this.value(frame, choice.weight, "weight", nonnegative),
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
      case "invert":
      case "forceSuccess":
      case "forceFailure": {
        const childResult = this.visit(frame.children[0]!, dt);
        if (childResult === "running") result = "running";
        else if (node.kind === "forceSuccess") result = "success";
        else if (node.kind === "forceFailure") result = "failure";
        else result = childResult === "success" ? "failure" : "success";
        break;
      }
    }
    this.checkCancellation();
    this.change(frame, result, result);
    return result;
  }

  private test(frame: Frame<C>, test: (context: C) => boolean): boolean {
    return this.invoke(frame, "condition", () => test(this.context));
  }

  private exit(frame: Frame<C>, reason: BehaviorExit): void {
    const action = frame.action;
    frame.action = undefined;
    if (action?.exit) this.invoke(frame, "exit", () => action.exit!(reason));
  }

  /**
   * Halt running work that is not on the path to `next`. Parallel children
   * keep their own running work: only the child that contains `next` gives way.
   * A sequence's later children keep theirs too: a reactive sequence runs its
   * earlier children again each tick, and the sequence itself halts the later
   * children when an earlier one does not succeed.
   */
  private haltOutside(frame: Frame<C>, next: string): void {
    if (frame.path === next) return;
    if (next.startsWith(`${frame.path}/`)) {
      const kind = frame.definition.kind;
      for (const child of frame.children) {
        const onPath = next === child.path || next.startsWith(`${child.path}/`);
        if (!onPath && kind === "parallel") continue;
        this.haltOutside(child, next);
        if (onPath && kind === "sequence") break;
      }
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

  private reset(frame: Frame<C>, reason: BehaviorTransitionReason): void {
    for (const child of frame.children) this.reset(child, reason);
    this.resetFrame(frame, reason, null);
  }

  private resetFrame(
    frame: Frame<C>,
    reason: BehaviorTransitionReason,
    by: string | null,
  ): void {
    frame.cursor = 0;
    frame.elapsed = 0;
    frame.duration = null;
    frame.accepted = null;
    frame.weights = undefined;
    frame.count = 0;
    frame.limit = null;
    frame.action = undefined;
    this.change(frame, "idle", reason, by);
  }

  private change(
    frame: Frame<C>,
    to: BehaviorNodeStatus,
    reason: BehaviorTransitionReason,
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
