import type { Entity, SceneTime } from "@yagejs/core";
import type { Abilities } from "./Abilities.js";
import type { Scalar } from "./scalar.js";

/** Data passed to a step's hooks when its ability is active. */
export interface StepContext {
  entity: Entity;
  def: AbilityDef;
  abilities: Abilities;
  /** The run this step belongs to — same object as `Abilities.active(lane)` while it's active. */
  activation: AbilityActivation;
  /** The owning scene's time-effect service, for steps that dilate or freeze time (see `slowmo`). */
  time: SceneTime;
}

/**
 * A stable handle to one ability run: identity-comparable with `===`, and
 * the same object everywhere it appears — `Abilities.active()`,
 * `StepContext`, `AbilitySpawnContext`, `PlayResult`, and both lifecycle
 * event payloads. A same-def restart (see `Abilities`'s activation rule)
 * creates a new handle; it never reuses one, since a later run can share the
 * earlier run's ability id and lane.
 */
export interface AbilityActivation {
  readonly def: AbilityDef;
  /** The lane this run occupies. */
  readonly lane: string;
  /** The entity running this activation — the spawned attack itself for a nested run, not necessarily the original caster. */
  readonly entity: Entity;
  /** Resolved duration: `def.duration`, or the timeline's last step end — floored to a small positive epsilon for a degenerate (empty, or all-instant-at-0) timeline that would otherwise resolve to 0. */
  readonly duration: number;
  /** Seconds since the run started, clamped to `duration`. Stops advancing once the run ends. */
  readonly elapsed: number;
  /** `"active"` while running; flips to a terminal value exactly once, when the run ends. */
  readonly state: "active" | "completed" | "cancelled";
  /** Started via `force()` rather than `play()`. Does not mean uninterruptible — see `AbilityDef.priority`. */
  readonly forced: boolean;
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
  /**
   * Seconds before `play(id)` can succeed again. Default 0 (no cooldown).
   * A `Scalar` function is resolved once each time the ability fires
   * (snapshot semantics), so a haste stat can shorten the next cooldown.
   */
  cooldown?: Scalar;
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

/** Result of `play`/`force`: check `ok` for the common case; on success, `activation` is the new run's handle; on refusal, `reason` says why. */
export type PlayResult =
  | { readonly ok: true; readonly activation: AbilityActivation }
  | { readonly ok: false; readonly reason: PlayRejection };
