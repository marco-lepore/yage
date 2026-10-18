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
export type BehaviorCancelReason =
  | "cancelled"
  | "disabled"
  | "destroyed"
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
      readonly kind: "guard";
      readonly test: (context: C) => boolean;
      readonly child: BehaviorNode<C>;
    }
  | { readonly kind: "subtree" | "invert"; readonly child: BehaviorNode<C> }
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
      readonly kind: "weightedSelector";
      readonly choices: readonly BehaviorWeightedChild<C>[];
      readonly onFailure?: "retry" | "fail";
    }
);

export interface BehaviorTransition {
  readonly tick: number;
  readonly path: string;
  readonly from: BehaviorNodeStatus;
  readonly to: BehaviorNodeStatus;
  readonly reason: string;
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
}

export interface BehaviorError {
  readonly tick: number;
  readonly path: string;
  readonly phase: string;
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

export interface BehaviorTreeOptions {
  /** Number of recent transitions retained. Default 128; zero disables history. */
  readonly historyLimit?: number;
  /** Headless hosts can share their existing boundary. Components bind theirs. */
  readonly errorBoundary?: ErrorBoundary;
  /** Returns a finite number in [0, 1). Components default to the scene RNG. */
  readonly random?: () => number;
}

/** Returned by behaviorNodes<C>(); the same nodes can be authored as objects. */
export interface BehaviorNodes<C> {
  action(id: string, create: (context: C) => BehaviorAction): BehaviorNode<C>;
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
  guard(
    id: string,
    test: (context: C) => boolean,
    child: BehaviorNode<C>,
  ): BehaviorNode<C>;
  subtree(id: string, child: BehaviorNode<C>): BehaviorNode<C>;
  invert(id: string, child: BehaviorNode<C>): BehaviorNode<C>;
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
