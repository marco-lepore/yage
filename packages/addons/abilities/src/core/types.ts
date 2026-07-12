import type { Entity } from "@yagejs/core";
import type { Abilities } from "./Abilities.js";

/** Data passed to a step's hooks when its ability is active. */
export interface StepContext {
  entity: Entity;
  def: AbilityDef;
  abilities: Abilities;
}

/**
 * Hooks for a step that fires once at a single time.
 *
 * Declared with method shorthand (not a `(params: P, ctx) => void` property)
 * so the parameter is checked bivariantly — this is what lets a `PointStep<P>`
 * for a concrete `P` sit alongside other steps in a `readonly AbilityStep[]`
 * timeline without a cast at each call site.
 */
export interface PointStepHooks<P> {
  fire(params: P, ctx: StepContext): void;
}

/** Hooks for a step that spans a time window. */
export interface WindowStepHooks<P> {
  enter?(params: P, ctx: StepContext): void;
  /** `cancelled` is true when the window closed via `Abilities.cancel()` or an interruption rather than reaching `to`. */
  exit?(params: P, ctx: StepContext, cancelled: boolean): void;
  tick?(params: P, ctx: StepContext): void;
}

/** A single instant in an ability's timeline. */
export interface PointStep<P extends object = object> {
  kind: string;
  /** Seconds from ability start. */
  at: number;
  params: P;
  hooks: PointStepHooks<P>;
}

/** A time span in an ability's timeline, half-open: fires `enter` at `from`, `exit` at `to`. */
export interface WindowStep<P extends object = object> {
  kind: string;
  /** Seconds from ability start. */
  from: number;
  /** Seconds from ability start. Must be greater than `from`. */
  to: number;
  /** Interval in seconds for repeated `tick` calls strictly between `from` and `to`. */
  every?: number;
  params: P;
  hooks: WindowStepHooks<P>;
}

/**
 * One entry in an ability's timeline. Steps carry different `params` shapes,
 * so the union is widened to `object` params here — `defineStep` factories
 * still return the narrow `PointStep<P>`/`WindowStep<P>` for the step author.
 */
export type AbilityStep = PointStep | WindowStep;

/**
 * A named, timed sequence of steps played by `Abilities.play` or forced by
 * `Abilities.force`. `lane` and `priority` govern the one activation rule
 * shared by both entry points (see `Abilities`): two defs in different lanes
 * run concurrently; two defs in the same lane resolve by priority, with a
 * forced def re-activating itself (same object) restarting in place.
 */
export interface AbilityDef {
  id: string;
  /** Exclusivity lane — only one activation per lane runs at a time. Default `"main"`. */
  lane?: string;
  /** Compared against the lane's active def to decide interrupts. Default 0. */
  priority?: number;
  /** Seconds before `play(id)` can succeed again. Default 0 (no cooldown). */
  cooldown?: number;
  /** Seconds the ability runs for. Defaults to the latest step end time (`at` or `to`). */
  duration?: number;
  timeline: readonly AbilityStep[];
}

/**
 * Why an activation was refused.
 * - `"cooldown"`: `play(id)` only — `id`'s cooldown has not elapsed
 *   (read `cooldownRemaining(id)` for how long is left).
 * - `"busy"`: the target lane is occupied by a def the incoming one cannot
 *   take — same-or-higher priority and not a same-def restart. Read
 *   `activeId(lane)` (and that def's `priority`) for what holds the lane.
 *   This is also the super-armor signal on the forced path: a `force(def)`
 *   whose `priority` does not outrank the active def returns this.
 */
export type PlayRejection = "cooldown" | "busy";

/** Result of `play`/`force`: check `ok` for the common case; on refusal, `reason` says why. */
export type PlayResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PlayRejection };
