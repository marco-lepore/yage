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
 * `StepContext`, `AbilitySpawnContext`, `PlayResult`, and the lifecycle
 * event payloads. A same-def restart (see `Abilities`'s activation rule)
 * creates a new handle; it never reuses one, since a later run can share the
 * earlier run's ability id and lane. A run spans the whole phase graph: phase
 * transitions keep the handle, only a new activation replaces it.
 */
export interface AbilityActivation {
  readonly def: AbilityDef;
  /** The lane this run occupies. */
  readonly lane: string;
  /** The entity running this activation — the spawned attack itself for a nested run, not necessarily the original caster. */
  readonly entity: Entity;
  /** Name of the current phase — `"main"` for a `timeline:` def. */
  readonly phase: string;
  /** Seconds since the current phase started, clamped to `phaseDuration`. */
  readonly phaseElapsed: number;
  /**
   * The current phase's resolved duration: its explicit `duration`, or the
   * phase timeline's last step end. `hold.max` for a capped hold phase,
   * `Infinity` for an uncapped one.
   */
  readonly phaseDuration: number;
  /** Whether the current phase is a hold phase. */
  readonly isHolding: boolean;
  /** Whether an open window step with `kind` is active in the current phase. */
  isStepActive(kind: string): boolean;
  /** Seconds since the run started, summed across every phase visited. Stops advancing once the run ends. */
  readonly elapsed: number;
  /** Seconds accumulated in `phase` during this activation — 0 if unvisited; re-entry accumulates. */
  elapsedIn(phase: string): number;
  /**
   * Data passed to the `send` that entered (or last transitioned) this run,
   * or `undefined`. Typed `unknown` — the game casts it (the same bare-token
   * precedent as `HitDealt.data`). A late charge delivery carries the
   * input-layer held time here.
   */
  readonly payload: unknown;
  /**
   * `"active"` while running; flips to a terminal value exactly once, when
   * the run ends.
   * - `"completed"`: the final phase reached its natural end, or a hold with
   *   no `next` was released.
   * - `"cancelled"`: `cancel()`/`cancelAll()`, a priority interrupt, a
   *   cancel-window admission, or a forced same-def restart.
   */
  readonly state: "active" | "completed" | "cancelled";
  /** Started via `force()` rather than `send()`. Does not mean uninterruptible — see `AbilityDef.priority`. */
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
   * `cancelled` is true when the window was cut short against the ability's
   * will — `Abilities.cancel()`, an interruption, or a cancel-window
   * admission. False when it closed as flow: reaching `to`, a phase
   * transition, a hold completed by `release()`, or the phase's natural end.
   */
  exit?(params: P, ctx: StepContext, cancelled: boolean): void;
  tick?(params: P, ctx: StepContext): void;
}

/** A single instant in a phase's timeline. */
export interface PointStep<P extends object = object> {
  kind: string;
  /** Seconds from phase start. */
  at: number;
  params: P;
  hooks: PointStepHooks<P>;
}

/** A time span in a phase's timeline, half-open: fires `enter` at `from`, `exit` at its end. */
export interface WindowStep<P extends object = object> {
  kind: string;
  /** Seconds from phase start. */
  from: number;
  /**
   * Seconds from phase start (must be greater than `from`), or `"end"`:
   * the window closes at the phase's natural boundary — the resolved
   * duration in a fixed phase, elastic (release/`hold.max`) in a hold phase.
   */
  to: number | "end";
  /** Interval in seconds for repeated `tick` calls between `from` and its end (strictly before a numeric `to`; indefinitely while an `"end"` window in a hold phase stays open). */
  every?: number;
  params: P;
  hooks: WindowStepHooks<P>;
}

/**
 * One entry in a phase's timeline. Steps carry different `params` shapes,
 * so the union is widened to `object` params here — `defineStep` factories
 * still return the narrow `PointStep<P>`/`WindowStep<P>` for the step author.
 */
export type AbilityStep = PointStep | WindowStep;

/** An exact ability id, `"*"` for any ability, or one definition tag. */
export type AbilityMatcher = string | { readonly tag: string };

/**
 * A window during which a busy lane yields to an incoming activation instead
 * of refusing it — the declaring phase's recovery being cancellable into a
 * dash, say. Bounds are on the phase-local clock (seconds from phase start).
 */
export interface CancelWindow {
  /** Seconds from phase start the window opens. */
  from: number;
  /** Seconds from phase start the window closes. Omitted = until the phase ends. */
  to?: number;
  /**
   * Ability matchers this window admits. Strings match resolved definition
   * ids, never intent aliases; `{ tag }` matches a tag on the resolved
   * definition. Omitted or `["*"]` (equivalent) admits any definition —
   * including the declaring def itself, a mash-restart; enumerate matchers to
   * exclude it.
   */
  into?: readonly AbilityMatcher[];
}

/**
 * The guarded form of an `on:` transition: `send(intent)` advances to `to`
 * while the phase-local clock is within `[from, until]`. An `until` past the
 * phase's natural end lingers: for the excess time after the ability
 * completes, the same intent starts a NEW activation entering at `to`, with
 * cooldown neither checked nor re-armed (see `Abilities.send`).
 */
interface PhaseTransitionBase {
  /** Target phase. */
  to: string;
}

/** A transition window with an absolute phase-local end. */
export interface AbsolutePhaseTransition extends PhaseTransitionBase {
  /** Seconds from phase start the transition becomes available. Default 0. */
  from?: number;
  /** Seconds from phase start it stops being available. Omitted = while the phase is active. */
  until?: number;
  for?: never;
}

/** A transition window expressed as a duration from its start. */
export interface RelativePhaseTransition extends PhaseTransitionBase {
  /** Seconds from phase start, or the resolved end of a fixed phase. Default 0. */
  from?: number | "end";
  /** Seconds the transition remains available after `from`. */
  for: number;
  until?: never;
}

export type PhaseTransition = AbsolutePhaseTransition | RelativePhaseTransition;

/** One named state in an ability's phase graph. */
export interface PhaseDef {
  /** Steps on this phase's local clock (0 = phase entry). */
  timeline: readonly AbilityStep[];
  /** Explicit phase length past the last step end (recovery). Not allowed on a hold phase — use `hold.max`. */
  duration?: number;
  /**
   * Marks an elastic phase bound to the intent that entered it: it runs until
   * that intent's `release()` (→ `next`), `after` fires, or `hold.max`
   * auto-completes. `true` = uncapped.
   */
  hold?: boolean | { max?: number };
  /** Overrides the def's `priority` while this phase is current — the activation's effective priority is always the current phase's. */
  priority?: number;
  /** Cancel windows on this phase's local clock. Overrides the def-level `cancels` sugar for this phase. */
  cancels?: readonly CancelWindow[];
  /**
   * Intent → transition map. A string is shorthand for `{ to }` (available
   * for the phase's whole life). A declared intent whose guard fails refuses
   * with `"noMatch"` and never falls through to cross-def entry; an
   * undeclared intent does fall through (see `Abilities.send`).
   */
  on?: Readonly<Record<string, string | PhaseTransition>>;
  /** Phase to auto-enter on natural end (duration reached, hold released, or `hold.max`). Omitted = the ability completes. */
  next?: string;
  /** Time-based auto-advance: enter `to` at phase-local `at`. In a hold phase this fires while still held (the charge-tier ladder). */
  after?: { at: number; to: string };
}

interface AbilityDefBase {
  id: string;
  /** Categories used by cancel-window `{ tag }` matchers. */
  tags?: readonly string[];
  /** Exclusivity lane — only one activation per lane runs at a time. Default `"main"`. */
  lane?: string;
  /** Default priority for every phase (see `PhaseDef.priority`). Compared against the lane's active phase to decide interrupts. Default 0. */
  priority?: number;
  /**
   * Seconds before `send(id)` can succeed again, checked and armed at
   * activation (cross-def entry only — phase transitions and linger
   * continuations neither check nor re-arm it). Default 0 (no cooldown).
   * A `Scalar` function is resolved once each time the ability fires
   * (snapshot semantics), so a haste stat can shorten the next cooldown.
   */
  cooldown?: Scalar;
  /** Sugar: cancel windows applied to every phase independently, each on that phase's local clock. A phase's own `cancels` overrides it. */
  cancels?: readonly CancelWindow[];
  /**
   * Extra intent → phase entry doors, used when the intent reaches the
   * cross-def entry step of `send`'s resolution (a late charge delivery, an
   * AI-only entry). The def's own id is always a door to its `start` phase.
   * Entry intents are global across the instance's defs — collisions are
   * construction errors.
   */
  entry?: Readonly<Record<string, string>>;
}

/** Single-phase sugar: `timeline:` authors exactly one phase named `"main"`. */
export interface TimelineAbilityDef extends AbilityDefBase {
  timeline: readonly AbilityStep[];
  /** Seconds the ability runs for. Defaults to the latest step end time (`at` or `to`). */
  duration?: number;
  phases?: never;
  start?: never;
}

/** The explicit phase-graph form. Mutually exclusive with `timeline:`. */
export interface PhasedAbilityDef extends AbilityDefBase {
  phases: Readonly<Record<string, PhaseDef>>;
  /** Initial phase. Defaults to the first `phases` key — name it explicitly rather than trusting key order when the map is built dynamically. */
  start?: string;
  timeline?: never;
  duration?: never;
}

/**
 * A named state machine of timed phases, entered by `Abilities.send` (its id
 * — or an `entry:` alias — is the intent) or forced by `Abilities.force`.
 * `lane` and `priority` govern the one activation rule shared by both entry
 * points (see `Abilities`): two defs in different lanes run concurrently;
 * two defs in the same lane resolve by priority, with a forced def
 * re-activating itself (same object) restarting in place.
 */
export type AbilityDef = TimelineAbilityDef | PhasedAbilityDef;

/**
 * Why an activation was refused.
 * - `"cooldown"`: the intent resolved to a cross-def entry whose cooldown
 *   has not elapsed (read `cooldownRemaining(id)` for how long is left).
 * - `"busy"`: the target lane is occupied by a def the incoming one cannot
 *   take — same-or-higher effective priority, not a same-def restart, and no
 *   admitting cancel window. Read `activeId(lane)` for what holds the lane.
 *   This is also the super-armor signal on the forced path: a `force(def)`
 *   whose priority does not outrank the active phase's returns this.
 * - `"noMatch"`: the intent is declared by the active (or lingering) phase
 *   but its guard window doesn't cover the current time — a mistimed press
 *   refuses rather than falling through — or it resolved to no entry at all
 *   for the queried lane.
 */
export type PlayRejection = "cooldown" | "busy" | "noMatch";

/** Options for {@link Abilities.send}. */
export interface AbilitySendOptions {
  /** Data stored on the activation when this intent enters or transitions it. */
  data?: unknown;
  /** Restrict intent resolution to one lane. */
  lane?: string;
}

/** Options for {@link Abilities.canSend}. */
export interface AbilityCanSendOptions {
  /** Restrict intent resolution to one lane. */
  lane?: string;
  /** Include admission through a higher-priority interrupt. Default false. */
  interrupts?: boolean;
}

/** Result of `send`/`force`: check `ok` for the common case; on success, `activation` is the run's handle (the existing one for a phase transition); on refusal, `reason` says why. */
export type PlayResult =
  | { readonly ok: true; readonly activation: AbilityActivation }
  | { readonly ok: false; readonly reason: PlayRejection };
