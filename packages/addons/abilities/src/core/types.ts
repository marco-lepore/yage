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
  /** Resolved duration: `def.duration`, or the timeline's last step end — floored to a small positive epsilon for a degenerate (empty, or all-instant-at-0) timeline that would otherwise resolve to 0. `Infinity` for a hold ability (a timeline with a `to: "release"` window), which runs until `release`/`cancel`/interruption. */
  readonly duration: number;
  /** Seconds since the run started, clamped to `duration`. Stops advancing once the run ends. */
  readonly elapsed: number;
  /**
   * `"active"` while running; flips to a terminal value exactly once, when
   * the run ends.
   * - `"completed"`: reached the timeline's end on its own, or ended via
   *   `release()`.
   * - `"cancelled"`: `cancel()`/`cancelAll()`, a priority interrupt, or a
   *   forced same-def restart — a run cut short against its will.
   * - `"chained"`: handed off to a def-sanctioned successor — a `chainWith`
   *   resolution or a cancel-window admission. Combat flow, not interruption.
   */
  readonly state: "active" | "completed" | "cancelled" | "chained";
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
  /**
   * `cancelled` is true when the window was cut short — `Abilities.cancel()`,
   * an interruption, or a def-sanctioned chain/cancel-window hand-off — rather
   * than reaching `to`. False only when it closed on its own (reaching `to`,
   * or a hold window closed by `release()`).
   */
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
  /**
   * Seconds from ability start (must be greater than `from`), or `"release"`
   * for a hold window: no scheduled end, closed by `Abilities.release()` (or
   * `cancel`/interruption). A def with any `"release"` window is a hold
   * ability with `Infinity` resolved duration.
   */
  to: number | "release";
  /** Interval in seconds for repeated `tick` calls between `from` and its end (strictly before a numeric `to`; indefinitely while a hold window is open). */
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
 * A window during which a busy lane yields to an incoming activation instead
 * of refusing it — the declaring def's recovery being cancellable into a
 * dash, say. Bounds are on the activation clock (seconds from start).
 */
export interface CancelWindow {
  /** Seconds from start the window opens. */
  from: number;
  /** Seconds from start the window closes. Omitted = until the ability ends. */
  to?: number;
  /**
   * Ability ids this window admits. Omitted or `["*"]` (equivalent) admits
   * any id — including the declaring def itself, a mash-restart; enumerate
   * ids to exclude it.
   */
  into?: readonly string[];
}

/**
 * A window during which the declaring def may hand off to a successor via
 * `Abilities.chainWith`. Bounds are on the activation clock; `until` MAY
 * exceed the ability's `duration`, and that post-end segment applies while
 * the lane sits idle after the ability completes (a per-lane memory the
 * runner keeps until the segment lapses or a new ability starts).
 */
export interface ChainWindow {
  /** Chain label the caller passes to `chainWith` — a game-chosen string, no gesture semantics. */
  on: string;
  /** Ability id to start when this window matches. Must share the declaring def's lane. */
  to: string;
  /** Seconds from start the window opens. */
  from: number;
  /** Seconds from start the window closes. Defaults to the ability's end; may exceed `duration`. */
  until?: number;
}

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
  /** Windows during which this ability's run yields to an incoming activation (see `CancelWindow`). */
  cancels?: readonly CancelWindow[];
  /** Windows during which this ability hands off to a successor via `chainWith` (see `ChainWindow`). */
  chains?: readonly ChainWindow[];
  timeline: readonly AbilityStep[];
}

/** Options for the `Abilities` constructor. */
export interface AbilitiesOptions {
  /**
   * Chain labels resolved to ability ids when a lane is idle — the entry
   * point of a chain (`{ light: "attack1" }`). `chainWith(label)` consults it
   * after the active def's chain windows and the post-end memory. Entries are
   * lane-scoped like chain windows: a target resolves only when the queried
   * lane is the target's own lane (`chainWith(label, lane)`). Targets are
   * validated at construction.
   */
  idle?: Readonly<Record<string, string>>;
}

/**
 * Why an activation was refused.
 * - `"cooldown"`: `play(id)`/`chainWith` — the target id's cooldown has not
 *   elapsed (read `cooldownRemaining(id)` for how long is left).
 * - `"busy"`: the target lane is occupied by a def the incoming one cannot
 *   take — same-or-higher priority, not a same-def restart, and no admitting
 *   cancel window. Read `activeId(lane)` (and that def's `priority`) for what
 *   holds the lane. This is also the super-armor signal on the forced path: a
 *   `force(def)` whose `priority` does not outrank the active def returns this.
 * - `"noMatch"`: `chainWith` only — the label resolved to no chain window,
 *   post-end memory, or idle-map entry for the lane's current state.
 */
export type PlayRejection = "cooldown" | "busy" | "noMatch";

/** Result of `play`/`force`: check `ok` for the common case; on success, `activation` is the new run's handle; on refusal, `reason` says why. */
export type PlayResult =
  | { readonly ok: true; readonly activation: AbilityActivation }
  | { readonly ok: false; readonly reason: PlayRejection };
