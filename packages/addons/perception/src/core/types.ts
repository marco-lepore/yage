import type { Vec2Like } from "@yagejs/core";

export interface PerceptionConfig {
  /** Acquisition distance in world pixels. Default 256. */
  range?: number;
  /** Retention distance while visible. Must be >= range. Default range. */
  loseRange?: number;
  /** Full angle in radians, from 0 to 2π, centered on the facing direction. Default 2π. */
  fieldOfView?: number;
  /** Seconds since last success before forgetting a lost target. Default 3. */
  memoryDuration?: number;
  /** Minimum visibility in (0, 1]. Default 0.01. Zero visibility always fails. */
  visibilityThreshold?: number;
}

export interface ResolvedPerceptionConfig {
  readonly range: number;
  readonly loseRange: number;
  readonly fieldOfView: number;
  readonly memoryDuration: number;
  readonly visibilityThreshold: number;
}

/** A sampled fact. A rejection never changes the last successful position. */
export interface PerceptionSample<T> {
  readonly id: string;
  readonly target: T;
  readonly position: Vec2Like;
  readonly visibility: number;
  /** null means detected; otherwise a nonempty reason such as "occluded". */
  readonly reason: string | null;
}

export interface PerceptionObservation<T> {
  readonly id: string;
  readonly target: T;
  readonly visible: boolean;
  readonly reason: string | null;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly lostAt: number | null;
  readonly lastPosition: Readonly<Vec2Like>;
  /** Visibility at the last successful observation. */
  readonly visibility: number;
}

export interface PerceptionTransition<T> {
  readonly type: "detected" | "lost" | "forgotten";
  readonly observation: PerceptionObservation<T>;
}

/**
 * Data only; ages are relative to capture time and rebased to the clock
 * supplied to restore. `PerceptionSensor.snapshot()` writes each target's
 * entity key as the record id.
 */
export interface PerceptionSnapshot {
  readonly version: 1;
  readonly records: readonly {
    readonly id: string;
    readonly firstSeenAge: number;
    readonly lastSeenAge: number;
    readonly lostAge: number | null;
    readonly lastPosition: Readonly<Vec2Like>;
    readonly visibility: number;
  }[];
}
