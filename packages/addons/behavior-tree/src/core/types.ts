import type { ErrorBoundary } from "@yagejs/core";

/** A tick completes, rejects the branch, or asks to continue next tick. */
export type BehaviorStatus = "success" | "failure" | "running";
export type BehaviorNodeStatus = BehaviorStatus | "idle";
/** Evaluated once per activation. Read current game state through the context. */
export type BehaviorNumber<C> = number | ((context: C) => number);

export interface BehaviorWeightedChild<C> {
  /** Finite nonnegative weight. Zero excludes this child for the activation. */
  readonly weight: BehaviorNumber<C>;
  readonly child: BehaviorNode<C>;
}

export interface BehaviorWeightedOptions {
  /** Default retry: draw again from untried children after failure. */
  readonly onFailure?: "retry" | "fail";
}

export interface BehaviorParallelOptions {
  /**
   * Default "all": succeed when every child succeeds, fail as soon as one
   * fails. "any": succeed as soon as one child succeeds, fail when every
   * child fails.
   */
  readonly success?: "all" | "any";
}

export type BehaviorCancelReason =
  | "cancelled"
  | "disabled"
  | "branch-changed"
  | "guard-failed"
  | "timeout";

export type BehaviorExit =
  | { readonly status: "success" | "failure" }
  | {
      readonly status: "cancelled";
      readonly reason: BehaviorCancelReason;
      /** Path of the node that caused the interruption, when known. */
      readonly by: string | null;
    };

/** One activation. Return a fresh object from the action factory. */
export interface BehaviorAction {
  /** Called once before the first tick. All callbacks are synchronous. */
  enter?: () => void;
  tick: (dt: number) => BehaviorStatus;
  /** Release movement requests, processes and other owned work here. */
  exit?: (result: BehaviorExit) => void;
}

/** Plain definitions are reusable. Execution state belongs to each runner. */
export type BehaviorNode<C> = { readonly id: string } & (
  | { readonly kind: "action"; readonly create: (context: C) => BehaviorAction }
  | { readonly kind: "condition"; readonly test: (context: C) => boolean }
  | {
      readonly kind: "sequence" | "selector";
      readonly children: readonly BehaviorNode<C>[];
      /** Default false: resume the running child. True: start at child zero. */
      readonly reactive?: boolean;
    }
  | {
      readonly kind: "parallel";
      readonly children: readonly BehaviorNode<C>[];
      readonly success?: "all" | "any";
    }
  | {
      readonly kind: "guard";
      readonly test: (context: C) => boolean;
      readonly child: BehaviorNode<C>;
    }
  | {
      readonly kind: "subtree" | "invert" | "forceSuccess" | "forceFailure";
      readonly child: BehaviorNode<C>;
    }
  | { readonly kind: "wait"; readonly seconds: BehaviorNumber<C> }
  | {
      readonly kind: "timeout" | "cooldown";
      readonly seconds: BehaviorNumber<C>;
      readonly child: BehaviorNode<C>;
    }
  | {
      readonly kind: "randomWait";
      readonly min: BehaviorNumber<C>;
      readonly max: BehaviorNumber<C>;
    }
  | {
      readonly kind: "chance";
      readonly probability: BehaviorNumber<C>;
      readonly child: BehaviorNode<C>;
    }
  | {
      readonly kind: "repeat";
      /** Integer >= 0, or Infinity to repeat until the child fails. */
      readonly times: BehaviorNumber<C>;
      readonly child: BehaviorNode<C>;
    }
  | {
      readonly kind: "retry";
      /** Integer >= 0, or Infinity to retry until the child succeeds. */
      readonly attempts: BehaviorNumber<C>;
      readonly child: BehaviorNode<C>;
    }
  | {
      readonly kind: "weightedSelector";
      readonly choices: readonly BehaviorWeightedChild<C>[];
      readonly onFailure?: "retry" | "fail";
    }
);

/** The callback, or the numeric field a callback supplied, that threw. */
export type BehaviorCallbackPhase =
  | "create"
  | "enter"
  | "tick"
  | "exit"
  | "condition"
  | "random"
  | "seconds"
  | "min"
  | "max"
  | "probability"
  | "weight"
  | "times"
  | "attempts";

export type BehaviorTransitionReason =
  | "enter"
  | BehaviorStatus
  | "restart"
  | "reevaluate"
  | BehaviorCancelReason;

export interface BehaviorTransition {
  readonly tick: number;
  readonly path: string;
  readonly from: BehaviorNodeStatus;
  readonly to: BehaviorNodeStatus;
  readonly reason: BehaviorTransitionReason;
  readonly by: string | null;
}

export interface BehaviorNodeInspection {
  readonly path: string;
  readonly id: string;
  readonly kind: BehaviorNode<never>["kind"];
  readonly status: BehaviorNodeStatus;
  readonly durationSeconds: number | null;
  readonly remainingSeconds: number | null;
  readonly chancePassed: boolean | null;
  readonly selectedChild: string | null;
  /** Sampled weights; failed choices become zero when retrying. */
  readonly remainingWeights: readonly number[] | null;
  /** Repeat: child successes this activation. Retry: child failures. */
  readonly count: number | null;
  /**
   * Sampled `times` or `attempts`; `Infinity` when unbounded. The Inspector
   * copies components through JSON, so there an unbounded limit reads `null`.
   */
  readonly limit: number | null;
}

export interface BehaviorError {
  readonly tick: number;
  readonly path: string;
  readonly phase: BehaviorCallbackPhase;
  readonly message: string;
}

export interface BehaviorInspection {
  readonly status: BehaviorNodeStatus;
  readonly tick: number;
  readonly activePaths: readonly string[];
  readonly nodes: readonly BehaviorNodeInspection[];
  readonly transitions: readonly BehaviorTransition[];
  readonly lastError: BehaviorError | null;
}

/** Remaining cooldown seconds keyed by node path; plain JSON. */
export interface BehaviorTreeSnapshot {
  readonly cooldowns: Readonly<Record<string, number>>;
}

export interface BehaviorTreeOptions {
  /** Number of recent transitions retained. Default 128; zero disables history. */
  readonly historyLimit?: number;
  /** Records callback errors. Default: a private boundary that logs and rethrows. */
  readonly errorBoundary?: ErrorBoundary;
  /** Returns a finite number in [0, 1). Required before a random node draws. */
  readonly random?: () => number;
  /** Entity and scene names recorded with callback errors. */
  readonly owner?: { readonly entity?: string; readonly scene?: string };
}

/** Returned by behaviorNodes<C>(); the same nodes can be authored as objects. */
export interface BehaviorNodes<C> {
  action(id: string, create: (context: C) => BehaviorAction): BehaviorNode<C>;
  /** An action that runs `run` once and succeeds in the same tick. */
  call(id: string, run: (context: C) => void): BehaviorNode<C>;
  condition(id: string, test: (context: C) => boolean): BehaviorNode<C>;
  sequence(
    id: string,
    children: readonly BehaviorNode<C>[],
    options?: { reactive?: boolean },
  ): BehaviorNode<C>;
  selector(
    id: string,
    children: readonly BehaviorNode<C>[],
    options?: { reactive?: boolean },
  ): BehaviorNode<C>;
  /** Tick every unfinished child on each visit. Each child keeps its own running work. */
  parallel(
    id: string,
    children: readonly BehaviorNode<C>[],
    options?: BehaviorParallelOptions,
  ): BehaviorNode<C>;
  guard(
    id: string,
    test: (context: C) => boolean,
    child: BehaviorNode<C>,
  ): BehaviorNode<C>;
  subtree(id: string, child: BehaviorNode<C>): BehaviorNode<C>;
  invert(id: string, child: BehaviorNode<C>): BehaviorNode<C>;
  forceSuccess(id: string, child: BehaviorNode<C>): BehaviorNode<C>;
  forceFailure(id: string, child: BehaviorNode<C>): BehaviorNode<C>;
  /** Run the child again on the next tick after each success; fail when it fails. */
  repeat(
    id: string,
    times: BehaviorNumber<C>,
    child: BehaviorNode<C>,
  ): BehaviorNode<C>;
  /** Run the child again on the next tick after each failure; succeed when it succeeds. */
  retry(
    id: string,
    attempts: BehaviorNumber<C>,
    child: BehaviorNode<C>,
  ): BehaviorNode<C>;
  wait(id: string, seconds: BehaviorNumber<C>): BehaviorNode<C>;
  randomWait(
    id: string,
    min: BehaviorNumber<C>,
    max: BehaviorNumber<C>,
  ): BehaviorNode<C>;
  chance(
    id: string,
    probability: BehaviorNumber<C>,
    child: BehaviorNode<C>,
  ): BehaviorNode<C>;
  weightedSelector(
    id: string,
    choices: readonly BehaviorWeightedChild<C>[],
    options?: BehaviorWeightedOptions,
  ): BehaviorNode<C>;
  /** Starts after child success; blocked visits fail. Time advances on every tree tick. */
  cooldown(
    id: string,
    seconds: BehaviorNumber<C>,
    child: BehaviorNode<C>,
  ): BehaviorNode<C>;
  timeout(
    id: string,
    seconds: BehaviorNumber<C>,
    child: BehaviorNode<C>,
  ): BehaviorNode<C>;
}
