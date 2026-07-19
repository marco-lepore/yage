import {
  Component,
  Process,
  ProcessComponent,
  SceneTimeKey,
  createKeyframeTrack,
  defineEvent,
} from "@yagejs/core";
import type { Entity, Keyframe, ProcessSlot } from "@yagejs/core";
import type {
  AbilitiesOptions,
  AbilityActivation,
  AbilityDef,
  AbilityStep,
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

/** How an activation ended — drives both terminal states and the exit-hook `cancelled` flag. */
type EndKind = "completed" | "cancelled" | "chained";

/**
 * Per-lane record of the last ability to complete there. `chainWith` reads it
 * to resolve a chain that fires after the ability ends but before its window
 * lapses (see `ChainWindow.until`): the effective activation-clock position is
 * `duration + age`. `process` ages `age` in scaled time until the reach lapses
 * (then it self-completes and `ProcessComponent` drops it). Armed only by a
 * completed end, cleared when any ability starts on the lane.
 */
interface LaneMemory {
  def: AbilityDef;
  duration: number;
  age: number;
  process: Process;
}

/** Emitted on the owning entity when an ability run starts, via `play` or `force`. */
export const AbilityStarted = defineEvent<{ activation: AbilityActivation }>(
  "ability:started",
);

/**
 * Emitted on the owning entity when an ability run ends: naturally,
 * cancelled, or interrupted by another activation — `cancelled` is false
 * only for a run that reached its timeline's end on its own. A same-def
 * restart (see `Abilities`'s activation rule) emits this with
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
 * A compiled event in a timeline, ordered for deterministic same-time
 * firing. `run` is pure — it takes the `ActivationHandle` it belongs to, so
 * the same compiled event can run against successive activations of the
 * same def (see `Abilities.getCompiled`).
 */
interface CompiledEvent {
  time: number;
  /** Lower fires first at equal `time`: exits (0) before fires/enters/ticks (1). */
  priority: number;
  /** Original position of the owning step in `def.timeline` — final tie-break. */
  order: number;
  run: (activation: ActivationHandle) => void;
}

interface CompiledAbility {
  duration: number;
  events: CompiledEvent[];
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

/**
 * One lane's live activation: the public `AbilityActivation` handle plus the
 * runner-private bookkeeping (`ctx`, `process`, `openWindows`) needed to
 * drive it. One instance per run — even a same-def restart gets a fresh
 * handle, since a later run can share an earlier run's id and lane. `ctx`
 * and `process` are filled in immediately after construction (see
 * `Abilities.start`): `ctx` needs `this` for its own self-reference, and the
 * keyframe track built from `process` needs `ctx` closed over first.
 */
class ActivationHandle implements AbilityActivation {
  ctx!: StepContext;
  process!: Process;
  readonly openWindows = new Set<WindowStep>();
  private _state: "active" | EndKind = "active";

  constructor(
    readonly def: AbilityDef,
    readonly lane: string,
    readonly entity: Entity,
    readonly duration: number,
    readonly forced: boolean,
  ) {}

  /** Clamped to `duration`; stops changing once `process` is cancelled/completed. `Infinity` duration (a hold ability) never clamps. */
  get elapsed(): number {
    return Math.min(this.process.elapsed, this.duration);
  }

  get state(): "active" | EndKind {
    return this._state;
  }

  /** Flip to a terminal state. Called exactly once, from `Abilities.finishLane`. */
  finish(end: EndKind): void {
    this._state = end;
  }
}

/**
 * Runs one entity's abilities: named data timelines played by id, each with
 * its own cooldown, or forced by def object (bypassing cooldown) via
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
 * abilities.play("swing");
 * ```
 *
 * Each def runs in a lane (`def.lane ?? "main"`) — only one activation per
 * lane at a time. `play(id)` and `force(def)` share one activation rule
 * against the target lane: an idle lane always proceeds; a busy lane
 * restarts if the same forced def re-activates itself, interrupts if the
 * incoming def's `priority` is strictly greater than the active def's, and
 * otherwise refuses. `force` differs from `play` in exactly one thing: it
 * neither checks nor arms cooldown.
 *
 * Emits `AbilityStarted`/`AbilityEnded` on the entity for every run; `active
 * (lane)` returns the current run's `AbilityActivation` handle (also on
 * `PlayResult.activation` and `StepContext.activation`) for reading its
 * resolved `duration`/`elapsed`/`state` without polling `activeId` and
 * re-deriving them from a game-side id→def table.
 */
export class Abilities extends Component {
  private readonly pc = this.sibling(ProcessComponent);
  private readonly defsById = new Map<string, AbilityDef>();
  private readonly compiledByDef = new WeakMap<AbilityDef, CompiledAbility>();
  private readonly cooldowns = new Map<string, Cooldown>();
  private readonly lanes = new Map<string, ActivationHandle>();
  /** Idle-lane chain entry map (`chainWith` label → ability id). */
  private readonly idleMap: Map<string, string>;
  /** Per-lane record of the last completed ability, for post-end chain windows. */
  private readonly lastEnded = new Map<string, LaneMemory>();
  /** Reused per hold-window-step slot driving its periodic `every` ticks while held. */
  private readonly holdTickSlots = new WeakMap<WindowStep, ProcessSlot>();

  // Lifecycle-event ordering — see `runEntry`'s doc.
  private entryDepth = 0;
  private draining = false;
  private readonly emissionQueue: Array<() => void> = [];

  constructor(defs: readonly AbilityDef[], options?: AbilitiesOptions) {
    super();
    for (const def of defs) {
      if (this.defsById.has(def.id)) {
        throw new Error(`Abilities: duplicate ability id "${def.id}".`);
      }
      this.defsById.set(def.id, def);
      this.getCompiled(def); // compile eagerly so a malformed def fails at construction, not first play
    }
    // All ids are known now — validate chain targets against them.
    for (const def of defs) this.validateChains(def);
    this.idleMap = new Map(Object.entries(options?.idle ?? {}));
    for (const [label, targetId] of this.idleMap) {
      if (!this.defsById.has(targetId)) {
        throw new Error(
          `Abilities: idle chain label "${label}" targets unknown ability id "${targetId}".`,
        );
      }
    }
  }

  /** Reject chain windows that target an unknown id or cross the declaring def's lane. */
  private validateChains(def: AbilityDef): void {
    if (!def.chains) return;
    const lane = def.lane ?? "main";
    for (const window of def.chains) {
      const target = this.defsById.get(window.to);
      if (!target) {
        throw new Error(
          `Abilities: ability "${def.id}" chains on "${window.on}" into unknown ability id "${window.to}".`,
        );
      }
      const targetLane = target.lane ?? "main";
      if (targetLane !== lane) {
        throw new Error(
          `Abilities: ability "${def.id}" (lane "${lane}") chains into "${window.to}" on a different lane "${targetLane}".`,
        );
      }
    }
  }

  /** Id of the lane's active ability, or null if idle. Defaults to the `"main"` lane. */
  activeId(lane = "main"): string | null {
    return this.lanes.get(lane)?.def.id ?? null;
  }

  /** Whether the lane has an active ability. Defaults to the `"main"` lane. */
  isActive(lane = "main"): boolean {
    return this.lanes.has(lane);
  }

  /** Seconds since the lane's active ability started, or null if idle. Defaults to the `"main"` lane. */
  elapsed(lane = "main"): number | null {
    const activation = this.lanes.get(lane);
    return activation ? activation.process.elapsed : null;
  }

  /** The lane's current run, or null if idle — never a dead handle. Defaults to the `"main"` lane. */
  active(lane = "main"): AbilityActivation | null {
    return this.lanes.get(lane) ?? null;
  }

  /**
   * Start an ability by id. Refused (no effect) if its lane is busy with a
   * def it cannot take, or if `id`'s cooldown hasn't elapsed — see
   * `PlayResult` for the reason. Throws for an unknown id — that's a
   * programmer error, not a runtime condition to check for.
   */
  play(id: string): PlayResult {
    return this.runEntry(() => {
      const def = this.mustGetDef(id);
      const cooldown = this.cooldowns.get(id);
      if (cooldown?.slot.running) return { ok: false, reason: "cooldown" };
      const result = this.activate(def, false);
      if (result.ok) this.armCooldown(def, result.activation);
      return result;
    });
  }

  /**
   * Force-activate `def`, bypassing cooldown entirely (there is none to
   * check or arm — forced defs are typically built fresh per hit, not
   * registered). Same activation rule as `play` — see `PlayResult` for the
   * refusal reason. `def` is validated the same way a constructor def is,
   * throwing on a malformed timeline.
   */
  force(def: AbilityDef): PlayResult {
    return this.runEntry(() => {
      this.getCompiled(def);
      return this.activate(def, true);
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

  /**
   * Complete a hold ability: if the lane's active def has a `to: "release"`
   * window currently open, close all its open windows with `cancelled: false`
   * and end the run as `"completed"`. No-op when the lane is idle or its
   * active ability has no open hold window (so a normal ability is untouched).
   * The release counterpart to a `to: "release"` window opened on key-down.
   */
  release(lane = "main"): void {
    this.runEntry(() => {
      const activation = this.lanes.get(lane);
      if (!activation) return;
      let holdOpen = false;
      for (const step of activation.openWindows) {
        if (step.to === "release") {
          holdOpen = true;
          break;
        }
      }
      if (!holdOpen) return;
      this.endActivation(lane, activation, "completed");
    });
  }

  /**
   * Hand off to the successor a chain `label` resolves to, on `lane`. Resolves
   * in order: the active def's chain windows (`elapsed` within `[from,
   * until]`) → the post-end memory of the last completed ability (a window
   * whose `until` extends past its `duration`) → the idle-map entry (only
   * when the target's own lane is the queried `lane`). A match
   * ends the current run as `"chained"` and starts the target, which still
   * pays its own cooldown (so `"cooldown"` is possible). `"noMatch"` when no
   * source resolves the label for the lane's current state. Early presses are
   * the caller's to buffer:
   *
   * ```ts
   * if (abilities.canChainWith("light") && input.consumeBufferedPress("attack", 0.15))
   *   abilities.chainWith("light");
   * ```
   *
   * An idle-map handoff isn't literally a chain, but chain labels exist only
   * for this system — plain abilities keep `play(id)`, and cancel windows key
   * on ids.
   */
  chainWith(label: string, lane = "main"): PlayResult {
    return this.runEntry(() => {
      const targetId = this.resolveChainLabel(label, lane);
      if (targetId === null) return { ok: false, reason: "noMatch" };
      const cooldown = this.cooldowns.get(targetId);
      if (cooldown?.slot.running) return { ok: false, reason: "cooldown" };
      const def = this.mustGetDef(targetId);
      const active = this.lanes.get(lane);
      if (active) this.endActivation(lane, active, "chained");
      const activation = this.start(def, def.lane ?? "main", false);
      this.armCooldown(def, activation);
      return { ok: true, activation };
    });
  }

  /**
   * Whether `chainWith(label, lane)` would succeed right now — the full
   * dry-run, window AND cooldown, with no side effects. Pair it with a
   * claim-once buffered press so an early tap fires the frame the chain opens.
   */
  canChainWith(label: string, lane = "main"): boolean {
    const targetId = this.resolveChainLabel(label, lane);
    if (targetId === null) return false;
    return !this.cooldowns.get(targetId)?.slot.running;
  }

  /**
   * Resolve a chain `label` to a target ability id for `lane`, or null.
   * While the lane is active, only the active def's chain windows resolve —
   * the idle map and post-end memory are idle-only, so a mistimed press
   * refuses rather than restarting the idle entry mid-ability.
   */
  private resolveChainLabel(label: string, lane: string): string | null {
    const active = this.lanes.get(lane);
    if (active) {
      const chains = active.def.chains;
      if (chains) {
        const elapsed = active.elapsed;
        for (const window of chains) {
          if (window.on !== label) continue;
          const until = window.until ?? active.duration;
          if (elapsed >= window.from && elapsed <= until) return window.to;
        }
      }
      return null;
    }
    const memory = this.lastEnded.get(lane);
    if (memory && !memory.process.completed && memory.def.chains) {
      const effectiveElapsed = memory.duration + memory.age;
      for (const window of memory.def.chains) {
        if (window.on !== label || window.until === undefined) continue;
        if (effectiveElapsed >= window.from && effectiveElapsed <= window.until)
          return window.to;
      }
    }
    // Idle-map entries are lane-scoped like chain windows: a target resolves
    // only from its own lane, so a handoff never starts on a lane the caller
    // didn't query.
    const idleTarget = this.idleMap.get(label);
    if (idleTarget === undefined) return null;
    const targetLane = this.mustGetDef(idleTarget).lane ?? "main";
    return targetLane === lane ? idleTarget : null;
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

  override onDestroy(): void {
    this.cancelAll();
  }

  /**
   * The one activation rule, shared by `play` and `force`: idle lane always
   * proceeds; a busy lane restarts on the same forced def, interrupts on
   * strictly higher priority, otherwise refuses.
   *
   * Loops instead of contesting the lane once: `endActivation` runs the
   * loser's exit hooks, and an exit hook can itself `play`/`force` a
   * replacement into this same lane before this call resumes (an
   * interrupt-from-inside-cancel). Re-reading `this.lanes.get(lane)` after
   * every cancellation re-applies the rule against whatever is actually
   * there now, so `def` gets contested against the real current occupant
   * instead of blindly overwriting it — every occupant that loses goes
   * through `endActivation` and gets exactly one `AbilityEnded`. A
   * refusal reached this way (busy against the *replacement*, not the
   * original occupant) is accepted: the first occupant is still gone.
   */
  private activate(def: AbilityDef, forced: boolean): PlayResult {
    const lane = def.lane ?? "main";
    for (;;) {
      const active = this.lanes.get(lane);
      if (!active) {
        return { ok: true, activation: this.start(def, lane, forced) };
      }
      const restart = forced && active.def === def;
      const interrupt = (def.priority ?? 0) > (active.def.priority ?? 0);
      if (restart || interrupt) {
        this.endActivation(lane, active, "cancelled");
        continue;
      }
      // A cancel window on the active def lets a def it admits take the lane
      // as combat flow (state "chained"), before the busy refusal.
      if (this.cancelWindowAdmits(active, def.id)) {
        this.endActivation(lane, active, "chained");
        continue;
      }
      return { ok: false, reason: "busy" };
    }
  }

  /** Whether `active`'s current `elapsed` sits in a cancel window that admits `incomingId`. */
  private cancelWindowAdmits(
    active: ActivationHandle,
    incomingId: string,
  ): boolean {
    const cancels = active.def.cancels;
    if (!cancels) return false;
    const elapsed = active.elapsed;
    for (const window of cancels) {
      if (elapsed < window.from) continue;
      if (window.to !== undefined && elapsed > window.to) continue;
      const into = window.into;
      if (into === undefined || into.includes("*") || into.includes(incomingId))
        return true;
    }
    return false;
  }

  /** Compile `def`'s timeline into a fresh activation and run it in `lane`. */
  private start(
    def: AbilityDef,
    lane: string,
    forced: boolean,
  ): ActivationHandle {
    // Any start on the lane clears its post-end chain memory (chain state
    // resets when a new ability begins).
    this.clearPostEndMemory(lane);
    const compiled = this.getCompiled(def);
    const activation = new ActivationHandle(
      def,
      lane,
      this.entity,
      compiled.duration,
      forced,
    );
    activation.ctx = {
      entity: this.entity,
      def,
      abilities: this,
      activation,
      time: this.use(SceneTimeKey),
    };

    // Each event is wrapped with an identity guard: if this lane no longer
    // holds `activation` (it was cancelled/replaced), the event is inert.
    // Needed because a hook can synchronously interrupt its own ability
    // (e.g. a punish forcing stagger from inside a tick hook) — the
    // interrupted track's remaining same-tick events must not fire against
    // the new activation.
    const keyframes: Keyframe<number>[] = [
      { time: 0, data: 0 },
      ...compiled.events.map((event) => ({
        time: event.time,
        data: 0,
        event: () => {
          if (this.lanes.get(lane) !== activation) return;
          event.run(activation);
        },
      })),
      { time: compiled.duration, data: 0 },
    ];

    activation.process = createKeyframeTrack({
      keyframes,
      duration: compiled.duration,
      onComplete: () =>
        this.runEntry(() => this.finishLane(lane, activation, "completed")),
    });
    this.lanes.set(lane, activation);
    this.pc.run(activation.process);
    this.enqueue(() => this.entity.emit(AbilityStarted, { activation }));
    return activation;
  }

  /** Cancel `activation`'s still-running process and close its lane out with `end`. Used for every non-natural end (`cancel`/`cancelAll`, interrupts, chain hand-offs, `release`). */
  private endActivation(
    lane: string,
    activation: ActivationHandle,
    end: EndKind,
  ): void {
    activation.process.cancel();
    this.finishLane(lane, activation, end);
  }

  /**
   * Natural completion and every forced end share this: close `activation`'s
   * open windows, then clear it from `lane`, flip its state, arm/clear the
   * post-end chain memory, and queue its `AbilityEnded` — but only if it's
   * still the lane's current activation. Checked twice: once at entry (a
   * `finishLane` reached via a stale closure, e.g. `onComplete` on a process
   * already replaced by an interrupt, is a no-op), and again after
   * `closeOpenWindows`.
   *
   * `end` drives two independent booleans: exit hooks receive `cancelled`
   * true for anything cut short (`"cancelled"` or `"chained"`), false only
   * for `"completed"`; `AbilityEnded.cancelled` is true only for
   * `"cancelled"` — a chained hand-off is combat flow, not interruption.
   *
   * The second check exists because an exit hook run by `closeOpenWindows`
   * can itself call `play`/`force` and install a replacement into this same
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
    this.closeOpenWindows(activation, end !== "completed");
    if (this.lanes.get(lane) !== activation) return;
    this.lanes.delete(lane);
    activation.finish(end);
    if (end === "completed") this.armPostEndMemory(lane, activation);
    else this.clearPostEndMemory(lane);
    const cancelled = end === "cancelled";
    this.enqueue(() =>
      this.entity.emit(AbilityEnded, { activation, cancelled }),
    );
  }

  /**
   * Arm the lane's post-end chain memory when the just-completed def has a
   * chain window reaching past its own `duration`. A dedicated `Process` ages
   * `memory.age` in scaled time so `resolveChainLabel` can read the post-end
   * segment while the lane is idle; it self-completes (and `ProcessComponent`
   * drops it) once the reach lapses.
   */
  private armPostEndMemory(lane: string, activation: ActivationHandle): void {
    const chains = activation.def.chains;
    if (!chains) return this.clearPostEndMemory(lane);
    let maxUntil = 0;
    for (const window of chains) {
      if (window.until !== undefined) maxUntil = Math.max(maxUntil, window.until);
    }
    const reach = maxUntil - activation.duration;
    if (reach <= 0) return this.clearPostEndMemory(lane);

    this.clearPostEndMemory(lane);
    // The arming call runs inside `ProcessComponent`'s process loop, so this
    // process is ticked once more this same frame — skip that first dt (it is
    // the completion's sub-frame overshoot) and age from the next frame on.
    let started = false;
    const memory: LaneMemory = {
      def: activation.def,
      duration: activation.duration,
      age: 0,
      process: new Process({
        update: (dt) => {
          if (!started) {
            started = true;
            return;
          }
          memory.age += dt;
          if (memory.age >= reach) return true;
        },
      }),
    };
    this.lastEnded.set(lane, memory);
    this.pc.run(memory.process);
  }

  private clearPostEndMemory(lane: string): void {
    const memory = this.lastEnded.get(lane);
    if (!memory) return;
    memory.process.cancel();
    this.lastEnded.delete(lane);
  }

  private closeOpenWindows(
    activation: ActivationHandle,
    cancelled: boolean,
  ): void {
    if (activation.openWindows.size === 0) return;
    for (const step of activation.def.timeline) {
      if (isWindowStep(step) && activation.openWindows.delete(step)) {
        if (step.to === "release") this.holdTickSlots.get(step)?.cancel();
        step.hooks.exit?.(step.params, activation.ctx, cancelled);
      }
    }
  }

  /**
   * Drive a hold window's periodic `every` ticks while it is held: a reused
   * slot (keyed by the step) that fires `tick` at each interval and stops
   * itself if the lane moves on. Cancelled when the window closes.
   */
  private startHoldTick(activation: ActivationHandle, step: WindowStep): void {
    const every = step.every!;
    let next = every;
    let slot = this.holdTickSlots.get(step);
    if (!slot) {
      slot = this.pc.slot();
      this.holdTickSlots.set(step, slot);
    }
    slot.restart({
      update: (_dt, elapsed) => {
        if (this.lanes.get(activation.lane) !== activation) return true;
        while (elapsed >= next) {
          step.hooks.tick?.(step.params, activation.ctx);
          next += every;
        }
        return false;
      },
    });
  }

  /**
   * Wrap one public entry point — `play`/`force`/`cancel`/`cancelAll`/
   * `release`/`chainWith`, and the process `onComplete` path — so lifecycle
   * events queued during it (by
   * this call, or by any reentrant call it triggers, e.g. a step hook that
   * itself calls `force`) deliver only once every state change for the
   * whole call tree has settled, and in the order they were queued.
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
      cooldown = { slot: this.pc.slot({ duration }), duration };
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

  /**
   * Validate and compile `def`, caching by def object identity — registered
   * defs compile once at construction; forced defs (typically built fresh
   * per hit) compile once each and are cheap enough at these sizes not to
   * warrant sharing.
   */
  private getCompiled(def: AbilityDef): CompiledAbility {
    let compiled = this.compiledByDef.get(def);
    if (!compiled) {
      compiled = this.compile(def, resolveDuration(def));
      this.compiledByDef.set(def, compiled);
    }
    return compiled;
  }

  /**
   * Build a pure-event list, ordered for deterministic same-time firing.
   * Each `CompiledEvent.run` takes the `ActivationHandle` it should act
   * against — `start` wraps each one with the identity guard described
   * there.
   */
  private compile(def: AbilityDef, duration: number): CompiledAbility {
    const events: CompiledEvent[] = [];

    def.timeline.forEach((step, order) => {
      if (isPointStep(step)) {
        events.push({
          time: step.at,
          priority: 1,
          order,
          run: (activation) => step.hooks.fire(step.params, activation.ctx),
        });
        return;
      }

      const hold = step.to === "release";
      events.push({
        time: step.from,
        priority: 1,
        order,
        run: (activation) => {
          activation.openWindows.add(step);
          step.hooks.enter?.(step.params, activation.ctx);
          // A hold window has no scheduled exit; its periodic ticks run off a
          // slot for as long as it stays open (closed by `closeOpenWindows`).
          if (hold && step.every !== undefined) this.startHoldTick(activation, step);
        },
      });
      if (typeof step.to === "number") {
        const to = step.to;
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
            const time = step.from + k * every;
            events.push({
              time,
              priority: 1,
              order,
              run: (activation) =>
                step.hooks.tick?.(step.params, activation.ctx),
            });
          }
        }
      }
    });

    events.sort(
      (a, b) => a.time - b.time || a.priority - b.priority || a.order - b.order,
    );

    // createKeyframeTrack requires duration > 0; an all-instant timeline (every
    // step at t=0, no explicit duration) resolves to 0 — floor it so the track
    // still completes on the first tick instead of throwing.
    return { duration: Math.max(duration, MIN_TRACK_DURATION), events };
  }
}

const MIN_TRACK_DURATION = 1e-6;

/**
 * Validate a def's timeline and resolve its duration, throwing on the first
 * problem found (naming the def id). Shared by construction (registered
 * defs) and `force` (defs built and validated at force-time).
 *
 * Rejects the same step object appearing twice in one timeline: several
 * step implementations (`invulnerable`, `hitbox`) key a per-run open-window
 * ledger by `(ctx, params)`, where `params` is the step's own object — a
 * repeated step object would collapse two windows onto one ledger key,
 * leaking the first one open forever once the second's `exit` overwrites it.
 */
function resolveDuration(def: AbilityDef): number {
  let maxEnd = 0;
  let hasHold = false;
  const seen = new Set<AbilityStep>();
  def.timeline.forEach((step, index) => {
    if (seen.has(step)) {
      throw new Error(
        `Abilities: ability "${def.id}" step "${step.kind}" (step #${index}) is the same step object as an earlier timeline entry — give each entry its own instance.`,
      );
    }
    seen.add(step);
    if (isPointStep(step)) {
      if (step.at < 0) {
        throw new Error(
          `Abilities: ability "${def.id}" step "${step.kind}" (step #${index}) has at=${step.at} < 0.`,
        );
      }
      maxEnd = Math.max(maxEnd, step.at);
    } else {
      if (step.from < 0) {
        throw new Error(
          `Abilities: ability "${def.id}" step "${step.kind}" (step #${index}) has from=${step.from} < 0.`,
        );
      }
      if (step.every !== undefined && step.every <= 0) {
        throw new Error(
          `Abilities: ability "${def.id}" step "${step.kind}" (step #${index}) has every=${step.every} <= 0.`,
        );
      }
      if (step.to === "release") {
        hasHold = true;
      } else {
        if (step.to <= step.from) {
          throw new Error(
            `Abilities: ability "${def.id}" step "${step.kind}" (step #${index}) has to=${step.to} <= from=${step.from}.`,
          );
        }
        maxEnd = Math.max(maxEnd, step.to);
      }
    }
  });

  // A hold window (`to: "release"`) makes the ability open-ended: it runs
  // until `release`/`cancel`/interruption, so an explicit finite duration is
  // contradictory.
  if (hasHold) {
    if (def.duration !== undefined) {
      throw new Error(
        `Abilities: ability "${def.id}" has a "release" hold window and an explicit duration ${def.duration} — a hold ability is open-ended, drop the duration.`,
      );
    }
    return Infinity;
  }

  if (def.duration !== undefined) {
    if (maxEnd > def.duration) {
      throw new Error(
        `Abilities: ability "${def.id}" has a step ending at ${maxEnd}, past its explicit duration ${def.duration}.`,
      );
    }
    return def.duration;
  }
  return maxEnd;
}
