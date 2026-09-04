import type {
  EasingFunction,
  Entity,
  RandomService,
  ServiceKey,
} from "@yagejs/core";

/** Values that can be fixed or randomized once for each cue playback. */
export type FeelRange = number | readonly [min: number, max: number];

/** Timing shared by finite effects that rise to a peak and return to rest. */
export interface FeelPulseTiming {
  /** Finite pulse duration in seconds, greater than or equal to zero. The default depends on the builder. */
  duration?: number;
  /** Finite normalized time of the pulse peak, from 0 to 1. The default depends on the builder. */
  peakAt?: number;
  /** Easing from rest to the peak. Must return a finite number. */
  attackEasing?: EasingFunction;
  /** Easing from the peak back to rest. Must return a finite number. */
  releaseEasing?: EasingFunction;
}

/** Context passed to an effect when its scheduled time begins. */
export interface FeelEffectContext {
  readonly entity: Entity;
  readonly cue: string;
  readonly intensity: number;
  /** Effective duration of this leaf after play-time retiming, or `null` for a state. */
  readonly duration: number | null;
  readonly random: RandomService;
  resolve<T>(key: ServiceKey<T>): T;
  invoke(label: string, callback: () => void): void;
}

/** Context passed to a timed effect leaf. */
export interface FeelTimedEffectContext extends FeelEffectContext {
  readonly duration: number;
}

/** Context passed to a state leaf. */
export interface FeelStateContext extends FeelEffectContext {
  readonly duration: null;
}

/** One live timed-effect leaf. All hooks are optional. */
export interface FeelEffectInstance {
  /** Callback attribution label used by the error boundary. */
  readonly label?: string;
  start?(): void;
  update?(progress: number, dt: number): void;
  /** Release an owned source without cancelling the rest of the cue. */
  release?(): void;
  /** Whether an owned source has completed. */
  isComplete?(): boolean;
  finish?(cancelled: boolean): void;
}

/** Factory for one timed leaf in a cue. */
export interface FeelEffectDefinition {
  readonly duration: number;
  create(context: FeelTimedEffectContext): FeelEffectInstance;
}

/** Attack and release timing for a state leaf. */
export interface FeelStateTiming {
  /** Seconds from zero to full amount. Default: `0`. */
  attack?: number;
  /** Seconds from the current amount to zero. Default: `0`. */
  release?: number;
  /** Easing applied during attack. Default: linear. */
  attackEasing?: EasingFunction;
  /** Easing applied during release. Default: linear. */
  releaseEasing?: EasingFunction;
}

/** One live state leaf. */
export interface FeelStateInstance {
  /** Callback attribution label used by the error boundary. */
  readonly label?: string;
  start?(): void;
  update(amount: number, dt: number): void;
  /** Called when the playback begins graceful release. */
  release?(): void;
  /** Whether an owned source has completed on its own. */
  isComplete?(): boolean;
  finish?(cancelled: boolean): void;
}

/** @internal Runtime clock mapping for one playback. */
export interface FeelRuntimeTiming {
  scale(seconds: number): number;
  toLocalDelta(seconds: number): number;
}

/** @internal Playback state read by runtime cue nodes. */
export interface FeelRuntimeControl {
  readonly cancelled: boolean;
  readonly released: boolean;
}

/** @internal One live node in the cue executor. */
export interface FeelRuntimeNode {
  readonly timelineComplete: boolean;
  readonly complete: boolean;
  advance(dt: number): number;
  release(): void;
  cancel(): void;
}

/** A cue tree produced by an effect or a composition helper. */
export interface FeelNode {
  /** Finite timeline duration, or `null` when completion needs release or an owned source. */
  readonly duration: number | null;
  /** @internal */
  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode;
}

export type FeelOverlap = "restart" | "ignore" | "allow";

/** Per-cue trigger policy. */
export interface FeelCueOptions {
  effect: FeelNode;
  /** Same-cue retrigger behavior. Default: `"restart"`. */
  overlap?: FeelOverlap;
  /** Probability from 0 to 1. Default: 1. */
  chance?: number;
  /** Minimum scaled seconds between accepted plays. Default: 0. */
  cooldown?: number;
  /** Default or randomized playback intensity. Default: 1. */
  intensity?: FeelRange;
}

export type FeelCue = FeelNode | FeelCueOptions;
export type FeelCueMap = Readonly<Record<string, FeelCue>>;

export interface FeelPlayOptions {
  /** Overrides the cue's configured intensity for this play. */
  intensity?: number;
  /** Replaces a finite cue's total timeline duration for this play. */
  duration?: number;
}

/** Handle returned by an accepted cue play. */
export interface FeelPlaybackHandle {
  readonly cue: string;
  readonly active: boolean;
  /** Resolves on natural completion, graceful release, or cancellation. */
  readonly finished: Promise<void>;
  /** Gracefully release held states and owned sources. */
  release(): void;
  /** Cancel this playback and restore every active effect immediately. */
  stop(): void;
}
