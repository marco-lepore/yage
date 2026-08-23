import type { Entity, RandomService, ServiceKey } from "@yagejs/core";

/** Values that can be fixed or randomized once for each cue playback. */
export type FeelRange = number | readonly [min: number, max: number];

/** Context passed to an effect when its scheduled time begins. */
export interface FeelEffectContext {
  readonly entity: Entity;
  readonly cue: string;
  readonly intensity: number;
  readonly random: RandomService;
  resolve<T>(key: ServiceKey<T>): T;
  invoke(label: string, callback: () => void): void;
}

/** One live effect leaf. All hooks are optional. */
export interface FeelEffectInstance {
  /** Callback attribution label used by the error boundary. */
  readonly label?: string;
  start?(): void;
  update?(progress: number, dt: number): void;
  finish?(cancelled: boolean): void;
}

/** Factory for one leaf in a cue. */
export interface FeelEffectDefinition {
  readonly duration: number;
  create(context: FeelEffectContext): FeelEffectInstance;
}

/** @internal Flattened leaf used by the cue player. */
export interface ScheduledFeelEffect {
  readonly at: number;
  readonly definition: FeelEffectDefinition;
}

/** A cue tree produced by an effect or a composition helper. */
export interface FeelNode {
  readonly duration: number;
  /** @internal */
  _schedule(at: number, output: ScheduledFeelEffect[]): void;
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
}

/** Handle returned by an accepted cue play. */
export interface FeelPlaybackHandle {
  readonly cue: string;
  readonly active: boolean;
  /** Resolves on natural completion or cancellation. */
  readonly finished: Promise<void>;
  /** Cancel this playback and restore every active effect. */
  stop(): void;
}
