import {
  Component,
  ErrorBoundaryKey,
  Process,
  ProcessComponent,
  SceneTimeKey,
  defineEvent,
} from "@yagejs/core";
import type { Entity, ProcessClock, ProcessSlot } from "@yagejs/core";
import type {
  AbilityActivation,
  AbilityCanSendOptions,
  AbilityDef,
  AbilitySendOptions,
  AbilityStep,
  CancelWindow,
  PhaseDef,
  PlayResult,
  PointStep,
  StepContext,
  WindowStep,
} from "./types.js";
import { resolveScalar } from "./scalar.js";

function isPointStep(step: AbilityStep): step is PointStep {
  return "at" in step;
}

function isWindowStep(step: AbilityStep): step is WindowStep {
  return "from" in step;
}

/** How an activation ended — drives both the terminal state and the exit-hook `cancelled` flag. */
type EndKind = "completed" | "cancelled";

/** Emitted on the owning entity when an ability run starts, via `send` or `force` — including a linger continuation, which is a new run. Phase transitions do not re-emit it. */
export const AbilityStarted = defineEvent<{ activation: AbilityActivation }>(
  "ability:started",
);

/**
 * Emitted on the owning entity when an ability run ends: naturally,
 * cancelled, or interrupted by another activation — `cancelled` is false
 * only for a run that completed on its own (its final phase's natural end,
 * or a released hold). A cancel-window admission cancels the occupant.
 * A same-def restart (see `Abilities`'s activation rule) emits this with
 * `cancelled: true` for the old run, immediately followed by
 * `AbilityStarted` for the new one — never a single "restarted" signal.
 *
 * Delivery is history, not live state — see `Abilities`'s `runEntry`/queue
 * doc for the ordering contract. Dropped entirely for a run ended by owner
 * destruction (`Entity.emit` no-ops once `destroy()` runs): poll the
 * activation's `state` instead when a spawned attack needs to react to its
 * caster's death.
 */
export const AbilityEnded = defineEvent<{
  activation: AbilityActivation;
  cancelled: boolean;
}>("ability:ended");

/**
 * Emitted on the owning entity when an activation moves between phases —
 * within-activation transitions only: initial entry is `AbilityStarted`, a
 * linger continuation is a new `AbilityStarted`. Delivered through the same
 * deferred queue as the other lifecycle events, so listeners observe settled
 * lane state; a transition superseded by a nested call never emits.
 */
export const AbilityPhaseChanged = defineEvent<{
  activation: AbilityActivation;
  from: string;
  to: string;
}>("ability:phase-changed");

/**
 * A compiled event in a phase's timeline, ordered for deterministic
 * same-time firing. `run` takes the `ActivationHandle` it acts against, so
 * the same compiled event can run against successive activations of the
 * same def (see `Abilities.getCompiled`).
 */
interface CompiledEvent {
  /** Phase-local seconds. */
  time: number;
  /** Lower fires first at equal `time`: window exits (0) before fires/enters/ticks (1) before `after` transitions (2). */
  priority: number;
  /** Original position of the owning step in the phase's timeline — final tie-break. */
  order: number;
  /** `track` is the phase track dispatching the event — an elastic window's enter registers its periodic ticks on it. */
  run: (activation: ActivationHandle, track: PhaseTrack) => void;
}

/** An `on:` guard normalized at compile time. `until` undefined = the phase's whole active life, no linger. */
interface ResolvedTransition {
  to: string;
  from: number;
  until: number | undefined;
}

/** One phase compiled: its sorted event list, resolved duration, and transition data. */
interface CompiledPhase {
  readonly name: string;
  /** The phase's steps in authored order — `closeOpenWindows` iterates this. */
  readonly steps: readonly AbilityStep[];
  readonly events: readonly CompiledEvent[];
  /** `hold.max` for a capped hold, `Infinity` for an uncapped one, else the explicit or derived duration. */
  readonly duration: number;
  readonly hold: boolean;
  /** Effective priority while this phase is current (`phase.priority ?? def.priority ?? 0`). */
  readonly priority: number;
  readonly cancels: readonly CancelWindow[] | undefined;
  readonly on: Readonly<Record<string, ResolvedTransition>> | undefined;
  readonly next: string | undefined;
  readonly after: { at: number; to: string } | undefined;
}

interface CompiledAbility {
  readonly start: string;
  readonly phases: ReadonlyMap<string, CompiledPhase>;
}

/** A cross-def entry door: `send(intent)` starts `def` at `phase` when the resolution reaches the entry step. */
interface EntryDoor {
  readonly def: AbilityDef;
  readonly phase: string;
}

/** A fully validated definition set ready to replace the runner's live indexes. */
interface DefinitionSet {
  readonly defsById: Map<string, AbilityDef>;
  readonly compiledByDef: WeakMap<AbilityDef, CompiledAbility>;
  readonly entryIndex: Map<string, EntryDoor>;
  readonly knownIntents: Set<string>;
}

/**
 * The runtime of one phase: a hand-rolled event track driven as a `Process`.
 * `position` is the phase-local clock; it differs from the process's raw
 * `elapsed` when the track was started mid-tick (see `firstDt`). One track
 * per phase entry — the (activation, track) pair is the identity guard every
 * compiled event checks, so a phase left mid-tick can't run its remaining
 * same-tick events (`transitionGen` handles the nested-transition case).
 */
interface PhaseTrack {
  process: Process;
  position: number;
  /** Next unfired index into the phase's sorted `events`. */
  index: number;
  /**
   * Replaces the first update's `dt` when the track was started from inside
   * one of this component's own event/completion hooks: `ProcessComponent`'s
   * tick visits processes added mid-iteration with the frame's full `dt`,
   * but a track born at phase-local instant `t` of the outgoing phase should
   * only advance by the tick's remainder past `t` (see `hookRemainder`).
   * `null` outside a tick — the first real update passes through unchanged.
   */
  firstDt: number | null;
  readonly duration: number;
  /**
   * Periodic `every` ticks of the phase's open elastic (`to: "end"` in a
   * hold) windows, driven off `position` itself so their cadence is
   * frame-size independent and catches up inside a large tick exactly like
   * a compiled window's ticks do. `next` is the next due phase-local time.
   */
  readonly holdTicks: Array<{ step: WindowStep; next: number }>;
}

/**
 * Per-lane record of the last ability to complete there, for linger: an
 * `on:` guard whose `until` reaches past its phase's natural end stays
 * resolvable for the excess time after the ability completes. `base` is the
 * phase-local time the run ended at (the resolved duration for a fixed
 * phase, the held time for a released hold); the effective guard position is
 * `base + age`. `process` ages `age` in scaled time until the reach lapses
 * (then it self-completes and `ProcessComponent` drops it). Armed only by a
 * completed end, cleared when any ability starts on the lane.
 */
interface LingerMemory {
  def: AbilityDef;
  phase: CompiledPhase;
  base: number;
  age: number;
  process: Process;
}

/**
 * One lane's live activation: the public `AbilityActivation` handle plus the
 * runner-private bookkeeping needed to drive it. One instance per run — even
 * a same-def restart gets a fresh handle, since a later run can share an
 * earlier run's id and lane. `ctx` and the first phase's `track` are filled
 * in immediately after construction (see `Abilities.startActivation`).
 */
class ActivationHandle implements AbilityActivation {
  ctx!: StepContext;
  track!: PhaseTrack;
  compiledPhase!: CompiledPhase;
  phaseName!: string;
  /**
   * The intent bound to the current hold phase — set on an intent-caused
   * entry into a hold, carried across `after`/`next` advances into further
   * holds, cleared on entering a fixed phase. `null` for a `force()`d hold
   * (no intent — only `after`/`hold.max`/`cancel` can end it).
   */
  heldIntent: string | null = null;
  payload: unknown = undefined;
  /** Incremented by every transition attempt; a transition whose claimed value is stale aborts (a nested call already moved the machine). */
  transitionGen = 0;
  readonly openWindows = new Set<WindowStep>();
  /** Seconds folded per completed phase visit; the current phase's live time is added on read. */
  private readonly visited = new Map<string, number>();
  private foldedTotal = 0;
  private _state: "active" | EndKind = "active";

  constructor(
    readonly def: AbilityDef,
    readonly lane: string,
    readonly entity: Entity,
    readonly forced: boolean,
  ) {}

  get phase(): string {
    return this.phaseName;
  }

  /** Clamped to the phase's duration; frozen once the run ends (the track's process stops advancing). */
  get phaseElapsed(): number {
    return Math.min(this.track.position, this.track.duration);
  }

  get phaseDuration(): number {
    return this.track.duration;
  }

  get isHolding(): boolean {
    return this.compiledPhase.hold;
  }

  isStepActive(kind: string): boolean {
    for (const step of this.openWindows) {
      if (step.kind === kind) return true;
    }
    return false;
  }

  get elapsed(): number {
    return (
      this.foldedTotal + (this._state === "active" ? this.phaseElapsed : 0)
    );
  }

  elapsedIn(phase: string): number {
    const folded = this.visited.get(phase) ?? 0;
    return this._state === "active" && phase === this.phaseName
      ? folded + this.phaseElapsed
      : folded;
  }

  get state(): "active" | EndKind {
    return this._state;
  }

  /**
   * Fold `t` seconds into the current phase's tally and the total. `t` is
   * the phase-local instant the machine actually left the phase at (see
   * `Abilities.foldTime`) — NOT necessarily the track's clamped position,
   * which mid-tick already includes the part of the frame that belongs to
   * the next phase.
   */
  foldPhase(t: number): void {
    this.visited.set(
      this.phaseName,
      (this.visited.get(this.phaseName) ?? 0) + t,
    );
    this.foldedTotal += t;
  }

  /** Flip to a terminal state. Called exactly once, from `Abilities.finishLane`. */
  finish(end: EndKind, foldT: number): void {
    this.foldPhase(foldT);
    this._state = end;
  }
}

/** Options for the `Abilities` component. */
export interface AbilitiesOptions {
  /**
   * The clock that advances this component's phase timelines, linger
   * windows, and cooldowns (see `ProcessClock` in `@yagejs/core`).
   *
   * The default `"fixed"` advances them on the fixed timestep — ability
   * timing is game logic, and this keeps windows, `after` schedules, and
   * cooldowns in step with a fixed-step simulation instead of drifting with
   * the frame rate. Pass `"frame"` for rendered-frame timing, e.g. purely
   * presentation-driven timelines with no simulation coupling. Sibling
   * processes on the same `ProcessComponent` (the game's own tweens,
   * `KeyframeAnimator` playback) keep their own clocks either way.
   */
  clock?: ProcessClock;
}

/**
 * Runs one entity's abilities: named phase machines activated by intent via
 * `send`, or forced by def object (reactions — bypassing cooldown) via
 * `force`. Requires a sibling `ProcessComponent`.
 *
 * ```ts
 * entity.add(new ProcessComponent());
 * entity.add(new Abilities([
 *   {
 *     id: "swing",
 *     cooldown: 0.5,
 *     timeline: [
 *       anim({ at: 0, name: "swing" }),
 *       hitbox({ from: 0.1, to: 0.25, shape: swingShape }),
 *     ],
 *   },
 * ]));
 *
 * abilities.send("swing");
 * ```
 *
 * A def with `timeline:` is a single phase named `"main"`; `phases:` authors
 * the explicit graph (see `AbilityDef`). Each def runs in a lane
 * (`def.lane ?? "main"`) — only one activation per lane at a time.
 *
 * `send(intent)` resolves in order:
 * 1. **The active phase's `on:` map** (each active lane in start order, or
 *    just `lane` when given). A *declared* intent whose guard window covers
 *    the phase-local clock transitions in place — same activation, no
 *    cooldown; a declared intent whose guard fails returns `"noMatch"` and
 *    resolution STOPS, so a mistimed combo press refuses instead of
 *    restarting the combo. An *undeclared* intent falls through.
 * 2. **Linger memory**: after an ability completes, an `on:` guard of its
 *    final phase whose `until` reached past the phase's end resolves for the
 *    excess time — starting a NEW activation of the same def at the target
 *    phase, with cooldown neither checked nor re-armed (flow continuation).
 *    The same stop-on-declared rule applies.
 * 3. **Cross-def entry**: the intent as a def id (its `start` phase) or an
 *    `entry:` alias. Cooldown is checked and armed here only. Admission:
 *    an idle lane always proceeds; a busy lane yields to a strictly higher
 *    entry-phase priority or an admitting cancel window on the occupant
 *    (which cancels it), and otherwise refuses `"busy"`.
 *
 * An intent matching none of the instance's installed vocabulary
 * (def ids, `entry:` aliases, `on:` keys) throws — that's a programmer
 * error, not a runtime refusal.
 *
 * `force(def)` differs from entry in exactly two things: it neither checks
 * nor arms cooldown, and a busy lane restarts when the same forced def
 * re-activates itself. Emits `AbilityStarted`/`AbilityEnded` per run and
 * `AbilityPhaseChanged` per within-run transition; `active(lane)` returns the
 * current run's `AbilityActivation` handle.
 *
 * Timelines, linger, and cooldowns advance on the fixed timestep by
 * default; pass `{ clock: "frame" }` for rendered-frame timing (see
 * `AbilitiesOptions`).
 */
export class Abilities extends Component {
  private readonly pc = this.sibling(ProcessComponent);
  private defsById = new Map<string, AbilityDef>();
  private compiledByDef = new WeakMap<AbilityDef, CompiledAbility>();
  private readonly cooldowns = new Map<string, Cooldown>();
  private readonly lanes = new Map<string, ActivationHandle>();
  /** Intent → cross-def entry door (def ids + `entry:` aliases). Collisions are construction errors. */
  private entryIndex = new Map<string, EntryDoor>();
  /** Every intent the installed defs can answer to — `send`/`canSend` throw outside it (typo guard). */
  private knownIntents = new Set<string>();
  /** Per-lane linger memory of the last completed ability (see `LingerMemory`). */
  private readonly lastEnded = new Map<string, LingerMemory>();

  // Lifecycle-event ordering — see `runEntry`'s doc.
  private entryDepth = 0;
  private draining = false;
  private readonly emissionQueue: Array<() => void> = [];
  /** Component removal is terminal; lifecycle listeners cannot start replacement work. */
  private disposed = false;
  /**
   * Exit hooks may install replacement work while destruction cancels every
   * lane. `cancelAll` re-reads the lanes and cancels that work in the same
   * teardown pass.
   */
  private tearingDown = false;
  /** Whether this component's clocks and open-window effects are enabled. */
  private resourcesEnabled = false;

  /**
   * Depth of this component's own track event/completion hooks on the call
   * stack, with `hookRemainder` the tick time left past the firing instant.
   * A track (or linger process) created while `hookDepth > 0` will be
   * visited by the same `ProcessComponent` tick with the frame's full `dt`
   * — `PhaseTrack.firstDt` substitutes the remainder so phase chains stay
   * frame-rate independent instead of double-counting the tick.
   */
  private hookDepth = 0;
  private hookRemainder = 0;
  /** The track whose event/completion hook is currently on the stack — `foldTime` only trusts `hookRemainder` for transitions on that same track. */
  private hookTrack: PhaseTrack | null = null;

  /**
   * The clock this component's processes are scheduled on — see
   * `AbilitiesOptions.clock`. Custom steps that start their own gameplay
   * timers can pass it along: `pc.run(p, { clock: ctx.abilities.clock })`.
   */
  readonly clock: ProcessClock;

  constructor(defs: readonly AbilityDef[], options?: AbilitiesOptions) {
    super();
    this.clock = options?.clock ?? "fixed";
    this.installDefinitionSet(this.buildDefinitionSet(defs));
  }

  /**
   * Replace the registered definitions without replacing this component.
   *
   * The prospective set is fully recompiled and validated first. On success,
   * active runs end as cancelled, linger and cooldown state are discarded,
   * and lifecycle listeners observe the new intent vocabulary.
   */
  replaceDefinitions(defs: readonly AbilityDef[]): void {
    const next = this.buildDefinitionSet(defs);
    this.runEntry(() => {
      this.cancelAll();
      this.clearAllLinger();
      this.removeAllCooldowns();
      this.installDefinitionSet(next);
    });
  }

  /**
   * Add definitions without disturbing active runs, cooldowns, or linger.
   * The complete prospective set is validated before the live indexes change.
   */
  addDefinitions(defs: readonly AbilityDef[]): void {
    const next = this.buildDefinitionSet([...this.defsById.values(), ...defs]);
    this.installDefinitionSet(next);
  }

  private buildDefinitionSet(defs: readonly AbilityDef[]): DefinitionSet {
    const defsById = new Map<string, AbilityDef>();
    const compiledByDef = new WeakMap<AbilityDef, CompiledAbility>();
    const compiledDefs: Array<{
      readonly def: AbilityDef;
      readonly compiled: CompiledAbility;
    }> = [];
    const entryIndex = new Map<string, EntryDoor>();
    const knownIntents = new Set<string>();

    for (const def of defs) {
      if (defsById.has(def.id)) {
        throw new Error(`Abilities: duplicate ability id "${def.id}".`);
      }
      defsById.set(def.id, def);
      const compiled = this.compile(def);
      compiledByDef.set(def, compiled);
      compiledDefs.push({ def, compiled });
    }

    const addEntryDoor = (
      intent: string,
      def: AbilityDef,
      phase: string,
    ): void => {
      const existing = entryIndex.get(intent);
      if (existing) {
        throw new Error(
          `Abilities: entry intent "${intent}" collides between abilities "${existing.def.id}" and "${def.id}".`,
        );
      }
      entryIndex.set(intent, { def, phase });
      knownIntents.add(intent);
    };

    for (const { def, compiled } of compiledDefs) {
      addEntryDoor(def.id, def, compiled.start);
      for (const [intent, phase] of Object.entries(def.entry ?? {})) {
        addEntryDoor(intent, def, phase);
      }
      for (const phase of compiled.phases.values()) {
        for (const intent of Object.keys(phase.on ?? {})) {
          knownIntents.add(intent);
        }
      }
    }

    return { defsById, compiledByDef, entryIndex, knownIntents };
  }

  private installDefinitionSet(definitions: DefinitionSet): void {
    this.defsById = definitions.defsById;
    this.compiledByDef = definitions.compiledByDef;
    this.entryIndex = definitions.entryIndex;
    this.knownIntents = definitions.knownIntents;
  }

  /** Id of the lane's active ability, or null if idle. Defaults to the `"main"` lane. */
  activeId(lane = "main"): string | null {
    return this.lanes.get(lane)?.def.id ?? null;
  }

  /** Whether the lane has an active ability. Defaults to the `"main"` lane. */
  isActive(lane = "main"): boolean {
    return this.lanes.has(lane);
  }

  /** Seconds since the lane's active ability started (across all its phases), or null if idle. Defaults to the `"main"` lane. */
  elapsed(lane = "main"): number | null {
    const activation = this.lanes.get(lane);
    return activation ? activation.elapsed : null;
  }

  /** The lane's current run, or null if idle — never a dead handle. Defaults to the `"main"` lane. */
  active(lane = "main"): AbilityActivation | null {
    return this.lanes.get(lane) ?? null;
  }

  /**
   * Send an intent — the one way in for both players and AI. See the class
   * doc for the three-step resolution (active phase `on:` → linger →
   * cross-def entry). `data` is stored on `activation.payload` when
   * provided; `lane` restricts every step to that lane (without it, active
   * lanes are scanned in start order and the entry door picks its own def's
   * lane). Throws for an intent no registered def can ever answer to.
   */
  send(intent: string, options: AbilitySendOptions = {}): PlayResult {
    const { data, lane } = options;
    return this.runEntry(() => {
      if (this.disposed || (!this.effectiveEnabled && !this.tearingDown)) {
        this.mustKnowIntent(intent);
        return { ok: false as const, reason: "busy" as const };
      }
      // 1. Active phase `on:` maps — stop on a declared intent.
      for (const [laneName, activation] of this.lanes) {
        if (lane !== undefined && laneName !== lane) continue;
        const guard = activation.compiledPhase.on?.[intent];
        if (guard === undefined) continue;
        const t = activation.phaseElapsed;
        if (t >= guard.from && t <= (guard.until ?? Infinity)) {
          if (data !== undefined) activation.payload = data;
          this.transition(activation, guard.to, intent);
          return { ok: true as const, activation };
        }
        return { ok: false as const, reason: "noMatch" as const };
      }
      // 2. Linger memory — same stop-on-declared rule.
      for (const [laneName, memory] of this.lastEnded) {
        if (lane !== undefined && laneName !== lane) continue;
        if (memory.process.completed) continue;
        const guard = memory.phase.on?.[intent];
        if (guard === undefined) continue;
        const position = memory.base + memory.age;
        if (
          guard.until !== undefined &&
          position >= guard.from &&
          position <= guard.until
        ) {
          // Flow continuation: a new activation at the target phase, with
          // cooldown neither checked nor re-armed (the run armed it at first
          // activation).
          const activation = this.startActivation(
            memory.def,
            guard.to,
            false,
            data,
            intent,
          );
          return { ok: true as const, activation };
        }
        return { ok: false as const, reason: "noMatch" as const };
      }
      // 3. Cross-def entry.
      const door = this.entryIndex.get(intent);
      if (door === undefined) {
        this.mustKnowIntent(intent);
        return { ok: false as const, reason: "noMatch" as const };
      }
      const targetLane = door.def.lane ?? "main";
      if (lane !== undefined && targetLane !== lane) {
        return { ok: false as const, reason: "noMatch" as const };
      }
      if (this.cooldowns.get(door.def.id)?.slot.running) {
        return { ok: false as const, reason: "cooldown" as const };
      }
      const result = this.activate(door.def, door.phase, false, data, intent);
      if (result.ok) this.armCooldown(door.def, result.activation);
      return result;
    });
  }

  /**
   * Whether `send(intent, { lane })` would succeed right now — with no side
   * effects. By default the entry step answers "would this be admitted
   * WITHOUT cutting the occupant off": a declared guard, linger, an idle
   * lane, or a cancel-window admission — deliberately excluding the
   * priority-interrupt door `send` also has, so a pending intent retried on
   * `canSend` waits for the occupant to end instead of preempting it. Pair
   * that default with a claim-once buffered press so an early tap fires the
   * frame its window opens.
   *
   * Pass `{ interrupts: true }` for the full dry-run: the entry step then
   * also answers true when the intent's entry-phase priority would win the
   * lane by interrupt — "would a direct `send` succeed", preemption
   * included.
   */
  canSend(intent: string, options: AbilityCanSendOptions = {}): boolean {
    const { lane } = options;
    if (this.disposed || (!this.effectiveEnabled && !this.tearingDown)) {
      this.mustKnowIntent(intent);
      return false;
    }
    for (const [laneName, activation] of this.lanes) {
      if (lane !== undefined && laneName !== lane) continue;
      const guard = activation.compiledPhase.on?.[intent];
      if (guard === undefined) continue;
      const t = activation.phaseElapsed;
      return t >= guard.from && t <= (guard.until ?? Infinity);
    }
    for (const [laneName, memory] of this.lastEnded) {
      if (lane !== undefined && laneName !== lane) continue;
      if (memory.process.completed) continue;
      const guard = memory.phase.on?.[intent];
      if (guard === undefined) continue;
      if (guard.until === undefined) return false;
      const position = memory.base + memory.age;
      return position >= guard.from && position <= guard.until;
    }
    const door = this.entryIndex.get(intent);
    if (door === undefined) {
      this.mustKnowIntent(intent);
      return false;
    }
    const targetLane = door.def.lane ?? "main";
    if (lane !== undefined && targetLane !== lane) return false;
    if (this.cooldowns.get(door.def.id)?.slot.running) return false;
    const occupant = this.lanes.get(targetLane);
    if (!occupant) return true;
    if (options?.interrupts) {
      const entryPriority = this.getCompiled(door.def).phases.get(
        door.phase,
      )!.priority;
      if (entryPriority > occupant.compiledPhase.priority) return true;
    }
    return this.cancelWindowAdmits(occupant, door.def);
  }

  /**
   * Release a held intent: when a lane's current phase is a hold bound to
   * `intent`, complete it — through `next` like any natural phase end (or
   * the whole ability completes when the phase has no `next`), with open
   * windows closed as flow (`cancelled: false`). Returns true exactly when
   * a hold completed; false is a no-op (nothing held on `intent` — the
   * driver's late-delivery fallback keys off this). A hold entered by
   * `force()` has no binding and never releases.
   */
  release(intent: string): boolean {
    return this.runEntry(() => {
      if (!this.effectiveEnabled && !this.tearingDown) return false;
      for (const [lane, activation] of this.lanes) {
        if (activation.heldIntent !== intent) continue;
        if (!activation.compiledPhase.hold) continue;
        const next = activation.compiledPhase.next;
        if (next !== undefined) this.transition(activation, next);
        else this.endActivation(lane, activation, "completed");
        return true;
      }
      return false;
    });
  }

  /**
   * Force-activate `def`, bypassing cooldown entirely (there is none to
   * check or arm — forced defs are typically built fresh per reaction, not
   * registered). Reactions only: an input-driven action goes through `send`.
   * Enters at the def's `start` phase; same admission rule as entry, plus
   * the same-def restart. `def` is validated the same way a constructor def
   * is, throwing on a malformed phase graph.
   */
  force(def: AbilityDef): PlayResult {
    return this.runEntry(() => {
      if (this.disposed || (!this.effectiveEnabled && !this.tearingDown)) {
        return { ok: false, reason: "busy" };
      }
      const compiled = this.getCompiled(def);
      return this.activate(def, compiled.start, true, undefined, undefined);
    });
  }

  /** Stop the lane's active ability, closing its open windows with `cancelled=true`. No-op when idle. Defaults to the `"main"` lane. */
  cancel(lane = "main"): void {
    this.runEntry(() => {
      const activation = this.lanes.get(lane);
      if (!activation) return;
      this.endActivation(lane, activation, "cancelled");
    });
  }

  /**
   * Stop every lane's active ability. Used by `onDestroy`.
   *
   * Re-reads `this.lanes` each iteration instead of snapshotting it once: an
   * exit hook run by one lane's cancellation can install a replacement into
   * another lane (or even re-arm this one) before this finishes — a
   * snapshot taken up front would miss it, leaving that replacement's
   * handle stuck `"active"` forever.
   */
  cancelAll(): void {
    this.runEntry(() => {
      while (this.lanes.size > 0) {
        const [lane, activation] = this.lanes.entries().next().value!;
        this.endActivation(lane, activation, "cancelled");
      }
    });
  }

  private clearAllLinger(): void {
    for (const lane of [...this.lastEnded.keys()]) this.clearLinger(lane);
  }

  private removeAllCooldowns(): void {
    for (const cooldown of this.cooldowns.values()) {
      this.pc.removeSlot(cooldown.slot);
    }
    this.cooldowns.clear();
  }

  /** Seconds remaining on `id`'s cooldown. 0 when ready. Throws for an unknown id. */
  cooldownRemaining(id: string): number {
    this.mustGetDef(id);
    const cooldown = this.cooldowns.get(id);
    if (!cooldown || cooldown.slot.completed) return 0;
    return Math.max(0, cooldown.duration - cooldown.slot.elapsed);
  }

  /** Cooldown progress ratio 0..1 (elapsed / cooldown). 1 when ready. Throws for an unknown id. */
  cooldownRatio(id: string): number {
    this.mustGetDef(id);
    const cooldown = this.cooldowns.get(id);
    if (!cooldown || cooldown.slot.completed) return 1;
    return cooldown.slot.ratio;
  }

  override onEnable(): void {
    if (this.resourcesEnabled) return;
    this.resourcesEnabled = true;
    this.enableOpenWindows();
    for (const activation of this.lanes.values()) {
      activation.track.process.resume();
    }
    for (const memory of this.lastEnded.values()) {
      memory.process.resume();
    }
    for (const cooldown of this.cooldowns.values()) {
      cooldown.slot.resume();
    }
  }

  override onDisable(): void {
    if (!this.resourcesEnabled) return;
    this.resourcesEnabled = false;
    for (const activation of this.lanes.values()) {
      activation.track.process.pause();
    }
    for (const memory of this.lastEnded.values()) {
      memory.process.pause();
    }
    for (const cooldown of this.cooldowns.values()) {
      cooldown.slot.pause();
    }
    this.disableOpenWindows();
  }

  override onDestroy(): void {
    this.runEntry(() => {
      this.tearingDown = true;
      try {
        this.cancelAll();
        this.clearAllLinger();
        this.removeAllCooldowns();
      } finally {
        // Exit hooks run during cancellation and may create replacement work;
        // cancelAll handles it. Event listeners run afterward and must not.
        this.disposed = true;
        this.tearingDown = false;
      }
    });
  }

  /**
   * The one admission rule, shared by `send`'s entry step and `force`: an
   * idle lane always proceeds; a busy lane restarts on the same forced def,
   * interrupts on a strictly higher entry-phase priority than the occupant's
   * current phase, yields through an admitting cancel window (the occupant
   * is cancelled), and otherwise refuses.
   *
   * Loops instead of contesting the lane once: `endActivation` runs the
   * loser's exit hooks, and an exit hook can itself `send`/`force` a
   * replacement into this same lane before this call resumes (an
   * interrupt-from-inside-cancel). Re-reading `this.lanes.get(lane)` after
   * every cancellation re-applies the rule against whatever is actually
   * there now, so `def` gets contested against the real current occupant
   * instead of blindly overwriting it — every occupant that loses goes
   * through `endActivation` and gets exactly one `AbilityEnded`. A
   * refusal reached this way (busy against the *replacement*, not the
   * original occupant) is accepted: the first occupant is still gone.
   */
  private activate(
    def: AbilityDef,
    entryPhase: string,
    forced: boolean,
    payload: unknown,
    viaIntent: string | undefined,
  ): PlayResult {
    const lane = def.lane ?? "main";
    const entryPriority =
      this.getCompiled(def).phases.get(entryPhase)!.priority;
    for (;;) {
      const active = this.lanes.get(lane);
      if (!active) {
        return {
          ok: true,
          activation: this.startActivation(
            def,
            entryPhase,
            forced,
            payload,
            viaIntent,
          ),
        };
      }
      const restart = forced && active.def === def;
      const interrupt = entryPriority > active.compiledPhase.priority;
      if (restart || interrupt || this.cancelWindowAdmits(active, def)) {
        this.endActivation(lane, active, "cancelled");
        continue;
      }
      return { ok: false, reason: "busy" };
    }
  }

  /** Whether the occupant's current phase sits in a cancel window (phase-local clock) that admits the resolved incoming definition. */
  private cancelWindowAdmits(
    active: ActivationHandle,
    incoming: AbilityDef,
  ): boolean {
    const cancels = active.compiledPhase.cancels;
    if (!cancels) return false;
    const elapsed = active.phaseElapsed;
    for (const window of cancels) {
      if (elapsed < window.from) continue;
      if (window.to !== undefined && elapsed > window.to) continue;
      const into = window.into;
      if (into === undefined) return true;
      for (const matcher of into) {
        if (typeof matcher === "string") {
          if (matcher === "*" || matcher === incoming.id) return true;
        } else if (incoming.tags?.includes(matcher.tag)) {
          return true;
        }
      }
    }
    return false;
  }

  /** Install a fresh activation on its lane and enter its first phase. Admission already settled by the caller. */
  private startActivation(
    def: AbilityDef,
    entryPhase: string,
    forced: boolean,
    payload: unknown,
    viaIntent: string | undefined,
  ): ActivationHandle {
    const lane = def.lane ?? "main";
    // Any start on the lane clears its linger memory (flow state resets when
    // a new ability begins).
    this.clearLinger(lane);
    const activation = new ActivationHandle(def, lane, this.entity, forced);
    activation.payload = payload;
    activation.ctx = {
      entity: this.entity,
      def,
      abilities: this,
      activation,
      time: this.use(SceneTimeKey),
    };
    this.lanes.set(lane, activation);
    this.startPhase(activation, entryPhase, viaIntent);
    this.enqueue(() => this.entity.emit(AbilityStarted, { activation }));
    return activation;
  }

  /** Enter `phaseName` on `activation`: bind or clear the hold intent and start the phase's track. */
  private startPhase(
    activation: ActivationHandle,
    phaseName: string,
    viaIntent: string | undefined,
  ): void {
    const phase = this.getCompiled(activation.def).phases.get(phaseName)!;
    if (phase.hold) {
      // Bind to the entering intent; a timer advance (`after`/`next`) into a
      // further hold carries the existing binding.
      if (viaIntent !== undefined) activation.heldIntent = viaIntent;
    } else {
      activation.heldIntent = null;
    }
    const track: PhaseTrack = {
      process: undefined as unknown as Process,
      position: 0,
      index: 0,
      firstDt: this.hookDepth > 0 ? this.hookRemainder : null,
      duration: phase.duration,
      holdTicks: [],
    };
    track.process = new Process({
      update: (dt) => this.tickTrack(activation, phase, track, dt),
    });
    activation.phaseName = phaseName;
    activation.compiledPhase = phase;
    activation.track = track;
    this.pc.run(track.process, { clock: this.clock });
  }

  /**
   * Advance one phase track: fire due events in compiled order, then handle
   * the phase's natural end. Every event is preceded by the identity guard
   * (lane still holds `activation`, `activation` still runs `track`) — a
   * hook can synchronously transition or cancel its own phase, and the
   * interrupted track's remaining same-tick events must not fire against
   * the new phase or activation.
   */
  private tickTrack(
    activation: ActivationHandle,
    phase: CompiledPhase,
    track: PhaseTrack,
    dt: number,
  ): void {
    this.hookDepth++;
    const previousRemainder = this.hookRemainder;
    const previousTrack = this.hookTrack;
    this.hookTrack = track;
    try {
      const effective = track.firstDt ?? dt;
      track.firstDt = null;
      track.position += effective;
      const events = phase.events;
      while (
        track.index < events.length &&
        events[track.index]!.time <= track.position
      ) {
        if (
          this.lanes.get(activation.lane) !== activation ||
          activation.track !== track
        ) {
          return;
        }
        const event = events[track.index++]!;
        this.hookRemainder = track.position - event.time;
        event.run(activation, track);
      }
      if (
        this.lanes.get(activation.lane) !== activation ||
        activation.track !== track
      ) {
        return;
      }
      this.runHoldTicks(activation, track);
      if (
        this.lanes.get(activation.lane) !== activation ||
        activation.track !== track
      ) {
        return;
      }
      if (track.position >= phase.duration) {
        this.hookRemainder = track.position - phase.duration;
        this.runEntry(() => this.finishPhase(activation, phase, track));
      }
    } finally {
      this.hookRemainder = previousRemainder;
      this.hookTrack = previousTrack;
      this.hookDepth--;
    }
  }

  /**
   * The phase-local instant the machine is actually leaving the current
   * phase at. Inside one of this activation's own track hooks that is the
   * hook's firing instant (`position` already includes the whole frame, and
   * the part past the hook belongs to the next phase — counting the full
   * position would tally that remainder twice). Everywhere else — external
   * calls, other lanes' or entities' hooks — it is the clamped position.
   */
  private foldTime(activation: ActivationHandle): number {
    const track = activation.track;
    const at =
      this.hookDepth > 0 && this.hookTrack === track
        ? track.position - this.hookRemainder
        : track.position;
    return Math.max(0, Math.min(at, track.duration));
  }

  /** A phase's natural end: advance through `next`, or complete the whole ability when there is none. */
  private finishPhase(
    activation: ActivationHandle,
    phase: CompiledPhase,
    track: PhaseTrack,
  ): void {
    if (
      this.lanes.get(activation.lane) !== activation ||
      activation.track !== track
    ) {
      return;
    }
    if (phase.next !== undefined) this.transition(activation, phase.next);
    else this.endActivation(activation.lane, activation, "completed");
  }

  /**
   * Move `activation` to phase `to` in place — not an end: no
   * `AbilityEnded`, cooldown untouched, the handle stays the same. Outgoing
   * windows close as flow (`cancelled: false`); their exit hooks can call
   * `send`/`force`/`cancel`, so after closing, the transition re-validates
   * both the activation's lane identity AND its `transitionGen` claim —
   * identity alone cannot detect a nested same-activation transition — and
   * aborts (emitting nothing) when a nested call already moved the machine.
   * `viaIntent` carries the hold binding (see `startPhase`).
   */
  private transition(
    activation: ActivationHandle,
    to: string,
    viaIntent?: string,
  ): void {
    const from = activation.phaseName;
    const gen = ++activation.transitionGen;
    this.closeOpenWindows(activation, false);
    if (this.lanes.get(activation.lane) !== activation) return;
    if (activation.transitionGen !== gen) return;
    activation.foldPhase(this.foldTime(activation));
    activation.track.process.cancel();
    this.startPhase(activation, to, viaIntent);
    this.enqueue(() =>
      this.entity.emit(AbilityPhaseChanged, { activation, from, to }),
    );
  }

  /** Cancel `activation`'s still-running track and close its lane out with `end`. Used for every end except a transition (which is not an end). */
  private endActivation(
    lane: string,
    activation: ActivationHandle,
    end: EndKind,
  ): void {
    activation.track.process.cancel();
    this.finishLane(lane, activation, end);
  }

  /**
   * Every end funnels here: close `activation`'s open windows, then clear it
   * from `lane`, flip its state, arm/clear the linger memory, and queue its
   * `AbilityEnded` — but only if it's still the lane's current activation.
   * Checked twice: once at entry (a stale closure is a no-op), and again
   * after `closeOpenWindows`.
   *
   * `end` drives two booleans the same way: exit hooks receive `cancelled`
   * true and `AbilityEnded.cancelled` is true exactly for `"cancelled"` —
   * a completed run (natural end or released hold) closes as flow.
   *
   * The second check exists because an exit hook run by `closeOpenWindows`
   * can itself call `send`/`force` and install a replacement into this same
   * lane synchronously (an interrupt from inside a cancel) — that nested
   * call runs this same method again for `activation` and fully finishes it
   * (deletes it, flips its state, queues its event) before this call
   * resumes. Without the re-check, this frame would still be holding a
   * now-stale `activation` and would go on to delete the replacement
   * (orphaning it — still running, but no longer tracked by `lanes`) and
   * queue a second `AbilityEnded` for a run already finished.
   */
  private finishLane(
    lane: string,
    activation: ActivationHandle,
    end: EndKind,
  ): void {
    if (this.lanes.get(lane) !== activation) return;
    const trackAtEntry = activation.track;
    this.closeOpenWindows(activation, end !== "completed");
    if (this.lanes.get(lane) !== activation) return;
    // An exit hook may have transitioned this SAME activation while its
    // windows closed (lane identity can't see that). An end is final:
    // cancel the nested transition's freshly started track so it can't
    // outlive the run as an orphaned process. Its queued phase event still
    // delivers — the activation did enter that phase for zero time before
    // ending, and the queue is history.
    if (activation.track !== trackAtEntry) activation.track.process.cancel();
    this.lanes.delete(lane);
    activation.finish(end, this.foldTime(activation));
    if (end === "completed") this.armLinger(lane, activation);
    else this.clearLinger(lane);
    const cancelled = end === "cancelled";
    this.enqueue(() =>
      this.entity.emit(AbilityEnded, { activation, cancelled }),
    );
  }

  /**
   * Arm the lane's linger memory when the just-completed run's final phase
   * has an `on:` guard reaching past where the run ended. A dedicated
   * `Process` ages `memory.age` in scaled time so `send`/`canSend` can read
   * the post-end guard position while the lane is idle; it self-completes
   * (and `ProcessComponent` drops it) once the reach lapses. When armed from
   * inside this component's own tick, the first update substitutes the
   * tick's remainder for the frame's full `dt` (same rule as
   * `PhaseTrack.firstDt`).
   */
  private armLinger(lane: string, activation: ActivationHandle): void {
    const phase = activation.compiledPhase;
    const base = Math.min(activation.track.position, phase.duration);
    let maxUntil = 0;
    for (const guard of Object.values(phase.on ?? {})) {
      if (guard.until !== undefined) maxUntil = Math.max(maxUntil, guard.until);
    }
    const reach = maxUntil - base;
    if (reach <= 0) return this.clearLinger(lane);

    this.clearLinger(lane);
    let firstDt: number | null = this.hookDepth > 0 ? this.hookRemainder : null;
    const memory: LingerMemory = {
      def: activation.def,
      phase,
      base,
      age: 0,
      process: new Process({
        update: (dt) => {
          const effective = firstDt ?? dt;
          firstDt = null;
          memory.age += effective;
          // Strictly past the reach: the guard range is inclusive, so a
          // press landing at exactly `until` must still find the memory
          // alive.
          if (memory.age > reach) return true;
        },
      }),
    };
    this.lastEnded.set(lane, memory);
    this.pc.run(memory.process, { clock: this.clock });
  }

  private clearLinger(lane: string): void {
    const memory = this.lastEnded.get(lane);
    if (!memory) return;
    memory.process.cancel();
    this.lastEnded.delete(lane);
  }

  /** Close every open window of the activation's current phase, in authored step order. */
  private closeOpenWindows(
    activation: ActivationHandle,
    cancelled: boolean,
  ): void {
    if (activation.openWindows.size === 0) return;
    for (const step of activation.compiledPhase.steps) {
      if (isWindowStep(step) && activation.openWindows.delete(step)) {
        step.hooks.exit?.(step.params, activation.ctx, cancelled);
      }
    }
  }

  private disableOpenWindows(): void {
    for (const [lane, activation] of [...this.lanes]) {
      if (this.lanes.get(lane) !== activation) continue;
      for (const step of activation.compiledPhase.steps) {
        if (!isWindowStep(step) || !activation.openWindows.has(step)) continue;
        const hook = step.hooks.onDisable;
        if (hook) {
          this.use(ErrorBoundaryKey).wrapCallback(
            () => hook(step.params, activation.ctx),
            {
              kind: "Ability window onDisable hook",
              entity: this.entity.name,
              scene: this.scene.name,
              event: step.kind,
            },
          );
        }
        if (this.lanes.get(lane) !== activation) break;
      }
    }
  }

  private enableOpenWindows(): void {
    for (const [lane, activation] of [...this.lanes]) {
      if (this.lanes.get(lane) !== activation) continue;
      for (const step of activation.compiledPhase.steps) {
        if (!isWindowStep(step) || !activation.openWindows.has(step)) continue;
        const hook = step.hooks.onEnable;
        if (hook) {
          this.use(ErrorBoundaryKey).wrapCallback(
            () => hook(step.params, activation.ctx),
            {
              kind: "Ability window onEnable hook",
              entity: this.entity.name,
              scene: this.scene.name,
              event: step.kind,
            },
          );
        }
        if (this.lanes.get(lane) !== activation) break;
      }
    }
  }

  /**
   * Fire the due periodic ticks of the phase's open elastic windows (see
   * `PhaseTrack.holdTicks`). Each tick re-checks the identity guards — a
   * tick hook can transition or cancel, and the remaining catch-up ticks of
   * that window must then stay unfired — and skips a window a hook already
   * closed. `next < duration` keeps a capped hold half-open like a compiled
   * window: no tick lands on the boundary itself.
   */
  private runHoldTicks(activation: ActivationHandle, track: PhaseTrack): void {
    for (const holdTick of track.holdTicks) {
      while (
        holdTick.next <= track.position &&
        holdTick.next < track.duration
      ) {
        if (
          this.lanes.get(activation.lane) !== activation ||
          activation.track !== track
        ) {
          return;
        }
        if (!activation.openWindows.has(holdTick.step)) break;
        this.hookRemainder = track.position - holdTick.next;
        holdTick.next += holdTick.step.every!;
        holdTick.step.hooks.tick?.(holdTick.step.params, activation.ctx);
      }
    }
  }

  /**
   * Wrap one public entry point — `send`/`force`/`release`/`cancel`/
   * `cancelAll`, and the track-completion path — so lifecycle events queued
   * during it (by this call, or by any reentrant call it triggers, e.g. a
   * step hook that itself calls `force`) deliver only once every state
   * change for the whole call tree has settled, and in the order they were
   * queued.
   *
   * Without this, a synchronous chain (hit lands → guard punishes → forces a
   * stagger reaction → its own exit hook forces a follow-up) would emit
   * events interleaved with in-progress state mutations, so a listener could
   * observe an `AbilityEnded` for a run whose replacement hasn't been
   * installed yet, or the reverse. With it: state settles synchronously
   * exactly where it always did (nothing about *when* a lane changes moves),
   * only *event delivery* is deferred — so by the time any queued listener
   * runs, `active(lane)` already reflects the outcome, even a still-later
   * one still ahead in the queue. `draining` guards against a listener's own
   * reentrant call trying to drain a second time from inside the loop below.
   */
  private runEntry<T>(fn: () => T): T {
    this.entryDepth++;
    try {
      return fn();
    } finally {
      this.entryDepth--;
      if (this.entryDepth === 0 && !this.draining) this.drainEmissions();
    }
  }

  private enqueue(emit: () => void): void {
    this.emissionQueue.push(emit);
  }

  private drainEmissions(): void {
    this.draining = true;
    try {
      while (this.emissionQueue.length > 0) {
        this.emissionQueue.shift()!();
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Arm `def`'s cooldown, resolving a `Scalar` cooldown once here against the
   * activation's context (snapshot semantics). The resolved duration can
   * differ per activation, so the slot re-arms with it each time and the
   * duration is cached for `cooldownRemaining`.
   */
  private armCooldown(def: AbilityDef, activation: AbilityActivation): void {
    const duration = resolveScalar(def.cooldown ?? 0, {
      entity: activation.entity,
      def,
      abilities: this,
      activation,
      time: this.use(SceneTimeKey),
    });
    if (duration <= 0) return;
    let cooldown = this.cooldowns.get(def.id);
    if (!cooldown) {
      cooldown = {
        slot: this.pc.slot({ duration, clock: this.clock }),
        duration,
      };
      this.cooldowns.set(def.id, cooldown);
    } else {
      cooldown.duration = duration;
    }
    cooldown.slot.start({ duration });
  }

  private mustGetDef(id: string): AbilityDef {
    const def = this.defsById.get(id);
    if (!def) {
      throw new Error(`Abilities: unknown ability id "${id}".`);
    }
    return def;
  }

  /** Throw for an intent outside the installed vocabulary — a typo, not a runtime refusal. */
  private mustKnowIntent(intent: string): void {
    if (!this.knownIntents.has(intent)) {
      throw new Error(
        `Abilities: unknown intent "${intent}" — no registered def id, entry alias, or phase transition answers to it.`,
      );
    }
  }

  /**
   * Validate and compile `def`, caching by def object identity — installed
   * defs compile once per definition set; forced defs (typically built fresh
   * per reaction) compile once each and are cheap enough at these sizes not
   * to warrant sharing.
   */
  private getCompiled(def: AbilityDef): CompiledAbility {
    let compiled = this.compiledByDef.get(def);
    if (!compiled) {
      compiled = this.compile(def);
      this.compiledByDef.set(def, compiled);
    }
    return compiled;
  }

  /** Normalize the `timeline:` sugar, compile every phase, and run the cross-phase validation. Throws on the first problem found, naming the def id. */
  private compile(def: AbilityDef): CompiledAbility {
    const hasTimeline = def.timeline !== undefined;
    const hasPhases = def.phases !== undefined;
    if (hasTimeline === hasPhases) {
      throw new Error(
        `Abilities: ability "${def.id}" must declare exactly one of \`timeline\` or \`phases\`.`,
      );
    }

    let phaseDefs: Readonly<Record<string, PhaseDef>>;
    let start: string;
    if (hasTimeline) {
      phaseDefs = {
        main: {
          timeline: def.timeline!,
          ...(def.duration !== undefined ? { duration: def.duration } : {}),
        },
      };
      start = "main";
    } else {
      phaseDefs = def.phases!;
      const keys = Object.keys(phaseDefs);
      if (keys.length === 0) {
        throw new Error(`Abilities: ability "${def.id}" has no phases.`);
      }
      start = def.start ?? keys[0]!;
      // Own-key check: `in` would accept Object.prototype names like
      // "toString" and defer the failure to first use.
      if (!Object.hasOwn(phaseDefs, start)) {
        throw new Error(
          `Abilities: ability "${def.id}" start phase "${start}" is not a phase key.`,
        );
      }
    }

    // The same step object may not appear twice anywhere in one def: several
    // step implementations (`invulnerable`, `hitbox`, `slowmo`) key a
    // per-run open-window ledger by (ctx, params), and ctx spans the whole
    // activation — a repeated step object (even across phases) would
    // collapse two windows onto one ledger key.
    const seenSteps = new Set<AbilityStep>();
    const phases = new Map<string, CompiledPhase>();
    for (const [name, phaseDef] of Object.entries(phaseDefs)) {
      phases.set(name, this.compilePhase(def, name, phaseDef, seenSteps));
    }

    const mustBePhase = (target: string, what: string): void => {
      if (!phases.has(target)) {
        throw new Error(
          `Abilities: ability "${def.id}" ${what} targets unknown phase "${target}".`,
        );
      }
    };
    for (const phase of phases.values()) {
      for (const [intent, guard] of Object.entries(phase.on ?? {})) {
        mustBePhase(guard.to, `phase "${phase.name}" on:"${intent}"`);
      }
      if (phase.next !== undefined) {
        mustBePhase(phase.next, `phase "${phase.name}" next`);
      }
      if (phase.after !== undefined) {
        mustBePhase(phase.after.to, `phase "${phase.name}" after`);
      }
    }
    for (const [intent, target] of Object.entries(def.entry ?? {})) {
      mustBePhase(target, `entry "${intent}"`);
    }

    this.rejectZeroTimeCycles(def, phases);
    return { start, phases };
  }

  /**
   * Reject `next`/`after` graphs that could advance forever without time
   * passing: a `next` edge out of a zero-duration fixed phase and an
   * `after` edge at 0 both fire the instant their phase is entered, so a
   * cycle of them would transition endlessly within a single tick.
   */
  private rejectZeroTimeCycles(
    def: AbilityDef,
    phases: ReadonlyMap<string, CompiledPhase>,
  ): void {
    const zeroEdges = new Map<string, string[]>();
    for (const [name, phase] of phases) {
      const edges: string[] = [];
      if (!phase.hold && phase.duration === 0 && phase.next !== undefined) {
        edges.push(phase.next);
      }
      if (phase.after !== undefined && phase.after.at === 0) {
        edges.push(phase.after.to);
      }
      zeroEdges.set(name, edges);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string): void => {
      if (done.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(
          `Abilities: ability "${def.id}" has a zero-time next/after cycle through phase "${name}".`,
        );
      }
      visiting.add(name);
      for (const target of zeroEdges.get(name) ?? []) visit(target);
      visiting.delete(name);
      done.add(name);
    };
    for (const name of phases.keys()) visit(name);
  }

  /** Validate one phase and build its sorted event list and resolved duration. */
  private compilePhase(
    def: AbilityDef,
    name: string,
    phase: PhaseDef,
    seenSteps: Set<AbilityStep>,
  ): CompiledPhase {
    const where = (step: AbilityStep, index: number): string =>
      `Abilities: ability "${def.id}" phase "${name}" step "${step.kind}" (step #${index})`;

    const hold = Boolean(phase.hold);
    const holdMax = typeof phase.hold === "object" ? phase.hold.max : undefined;
    if (holdMax !== undefined && holdMax <= 0) {
      throw new Error(
        `Abilities: ability "${def.id}" phase "${name}" has hold.max=${holdMax} <= 0.`,
      );
    }
    if (hold && phase.duration !== undefined) {
      throw new Error(
        `Abilities: ability "${def.id}" phase "${name}" is a hold with an explicit duration ${phase.duration} — a hold is elastic; cap it with hold.max instead.`,
      );
    }

    // First pass: step validation + the derived end for fixed phases.
    let maxEnd = 0;
    phase.timeline.forEach((step, index) => {
      if (seenSteps.has(step)) {
        throw new Error(
          `${where(step, index)} is the same step object as an earlier entry in this def — give each entry its own instance.`,
        );
      }
      seenSteps.add(step);
      if (isPointStep(step)) {
        if (step.at < 0) {
          throw new Error(`${where(step, index)} has at=${step.at} < 0.`);
        }
        maxEnd = Math.max(maxEnd, step.at);
        return;
      }
      if (step.from < 0) {
        throw new Error(`${where(step, index)} has from=${step.from} < 0.`);
      }
      if (step.every !== undefined && step.every <= 0) {
        throw new Error(`${where(step, index)} has every=${step.every} <= 0.`);
      }
      if (typeof step.to === "number") {
        if (step.to <= step.from) {
          throw new Error(
            `${where(step, index)} has to=${step.to} <= from=${step.from}.`,
          );
        }
        maxEnd = Math.max(maxEnd, step.to);
      } else if (step.to !== "end") {
        throw new Error(
          `${where(step, index)} has to=${String(step.to)} — expected a number or "end".`,
        );
      } else {
        // An "end" window must at least open before the boundary.
        maxEnd = Math.max(maxEnd, step.from);
      }
    });

    let duration: number;
    if (hold) {
      duration = holdMax ?? Infinity;
      if (maxEnd > duration) {
        throw new Error(
          `Abilities: ability "${def.id}" phase "${name}" has a step ending at ${maxEnd}, past its hold.max ${duration}.`,
        );
      }
    } else if (phase.duration !== undefined) {
      if (maxEnd > phase.duration) {
        throw new Error(
          `Abilities: ability "${def.id}" phase "${name}" has a step ending at ${maxEnd}, past its explicit duration ${phase.duration}.`,
        );
      }
      duration = phase.duration;
    } else {
      duration = maxEnd;
    }

    // Second pass: checks that need the resolved duration.
    phase.timeline.forEach((step, index) => {
      if (isWindowStep(step) && step.to === "end" && step.from >= duration) {
        throw new Error(
          `${where(step, index)} opens at ${step.from}, at or past the phase's end ${duration} — an "end" window in a fixed phase needs room before the boundary (add a duration, later steps, or make the phase a hold).`,
        );
      }
    });

    // Null prototype: `on` is indexed by user intent strings, and an intent
    // named like an Object.prototype key must miss, not resolve.
    const on: Record<string, ResolvedTransition> = Object.create(
      null,
    ) as Record<string, ResolvedTransition>;
    for (const [intent, raw] of Object.entries(phase.on ?? {})) {
      let guard: ResolvedTransition;
      if (typeof raw === "string") {
        guard = { to: raw, from: 0, until: undefined };
      } else {
        const rawFrom = raw.from ?? 0;
        if (rawFrom === "end" && hold) {
          throw new Error(
            `Abilities: ability "${def.id}" phase "${name}" on:"${intent}" uses from="end" on a hold phase.`,
          );
        }
        const from = rawFrom === "end" ? duration : rawFrom;
        let until: number | undefined;
        if (raw.for !== undefined) {
          if (!Number.isFinite(raw.for) || raw.for <= 0) {
            throw new Error(
              `Abilities: ability "${def.id}" phase "${name}" on:"${intent}" has for=${raw.for}; expected a finite duration > 0.`,
            );
          }
          until = from + raw.for;
        } else {
          until = raw.until;
        }
        guard = { to: raw.to, from, until };
      }
      if (guard.from < 0) {
        throw new Error(
          `Abilities: ability "${def.id}" phase "${name}" on:"${intent}" has from=${guard.from} < 0.`,
        );
      }
      if (guard.until !== undefined && guard.until <= guard.from) {
        throw new Error(
          `Abilities: ability "${def.id}" phase "${name}" on:"${intent}" has until=${guard.until} <= from=${guard.from}.`,
        );
      }
      on[intent] = guard;
    }

    const after = phase.after;
    if (after !== undefined) {
      if (after.at < 0) {
        throw new Error(
          `Abilities: ability "${def.id}" phase "${name}" has after.at=${after.at} < 0.`,
        );
      }
      if (after.at >= duration) {
        throw new Error(
          `Abilities: ability "${def.id}" phase "${name}" has after.at=${after.at} at or past the phase's end ${duration} — it would never fire.`,
        );
      }
    }

    const priority = phase.priority ?? def.priority ?? 0;
    const cancels = phase.cancels ?? def.cancels;
    const events = this.compileEvents(phase, hold, duration);

    return {
      name,
      steps: phase.timeline,
      events,
      duration,
      hold,
      priority,
      cancels,
      on: Object.keys(on).length > 0 ? on : undefined,
      next: phase.next,
      after,
    };
  }

  /** Build one phase's sorted event list from its (already validated) steps and `after`. */
  private compileEvents(
    phase: PhaseDef,
    hold: boolean,
    duration: number,
  ): CompiledEvent[] {
    const events: CompiledEvent[] = [];

    phase.timeline.forEach((step, order) => {
      if (isPointStep(step)) {
        events.push({
          time: step.at,
          priority: 1,
          order,
          run: (activation) => step.hooks.fire(step.params, activation.ctx),
        });
        return;
      }

      // A hold phase's "end" window has no scheduled exit (the phase's end
      // is elastic — `closeOpenWindows` closes it); its periodic ticks run
      // off the phase track's own clock for as long as it stays open (see
      // `runHoldTicks`). Everywhere else the end is a known time and both
      // exit and ticks compile statically.
      const elastic = hold && step.to === "end";
      events.push({
        time: step.from,
        priority: 1,
        order,
        run: (activation, track) => {
          activation.openWindows.add(step);
          step.hooks.enter?.(step.params, activation.ctx);
          if (elastic && step.every !== undefined) {
            // The enter hook itself may have transitioned or ended the
            // activation — its windows are closed then, and the ticks must
            // not attach to the successor phase's track.
            if (activation.track !== track) return;
            track.holdTicks.push({ step, next: step.from + step.every });
          }
        },
      });
      if (!elastic) {
        const to = step.to === "end" ? duration : (step.to as number);
        events.push({
          time: to,
          priority: 0,
          order,
          run: (activation) => {
            activation.openWindows.delete(step);
            step.hooks.exit?.(step.params, activation.ctx, false);
          },
        });
        if (step.every !== undefined) {
          const every = step.every;
          for (let k = 1; step.from + k * every < to; k++) {
            events.push({
              time: step.from + k * every,
              priority: 1,
              order,
              run: (activation) =>
                step.hooks.tick?.(step.params, activation.ctx),
            });
          }
        }
      }
    });

    const after = phase.after;
    if (after !== undefined) {
      events.push({
        time: after.at,
        priority: 2,
        order: phase.timeline.length,
        run: (activation) =>
          this.runEntry(() => this.transition(activation, after.to)),
      });
    }

    events.sort(
      (a, b) => a.time - b.time || a.priority - b.priority || a.order - b.order,
    );
    return events;
  }
}

/**
 * A def's cooldown timer plus the duration it was last armed with. A
 * `Scalar` cooldown resolves per activation, so the armed duration isn't
 * `def.cooldown` — `cooldownRemaining` reads it here.
 */
interface Cooldown {
  slot: ProcessSlot;
  duration: number;
}
