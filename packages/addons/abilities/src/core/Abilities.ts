import {
  Component,
  ProcessComponent,
  createKeyframeTrack,
  defineEvent,
} from "@yagejs/core";
import type { Entity, Keyframe, Process, ProcessSlot } from "@yagejs/core";
import type {
  AbilityActivation,
  AbilityDef,
  AbilityStep,
  PlayResult,
  PointStep,
  StepContext,
  WindowStep,
} from "./types.js";

function isPointStep(step: AbilityStep): step is PointStep {
  return "at" in step;
}

function isWindowStep(step: AbilityStep): step is WindowStep {
  return "from" in step;
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
  private _state: "active" | "completed" | "cancelled" = "active";

  constructor(
    readonly def: AbilityDef,
    readonly lane: string,
    readonly entity: Entity,
    readonly duration: number,
    readonly forced: boolean,
  ) {}

  /** Clamped to `duration`; stops changing once `process` is cancelled/completed. */
  get elapsed(): number {
    return Math.min(this.process.elapsed, this.duration);
  }

  get state(): "active" | "completed" | "cancelled" {
    return this._state;
  }

  /** Flip to a terminal state. Called exactly once, from `Abilities.finishLane`. */
  finish(cancelled: boolean): void {
    this._state = cancelled ? "cancelled" : "completed";
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
  private readonly cooldownSlots = new Map<string, ProcessSlot>();
  private readonly lanes = new Map<string, ActivationHandle>();

  // Lifecycle-event ordering — see `runEntry`'s doc.
  private entryDepth = 0;
  private draining = false;
  private readonly emissionQueue: Array<() => void> = [];

  constructor(defs: readonly AbilityDef[]) {
    super();
    for (const def of defs) {
      if (this.defsById.has(def.id)) {
        throw new Error(`Abilities: duplicate ability id "${def.id}".`);
      }
      this.defsById.set(def.id, def);
      this.getCompiled(def); // compile eagerly so a malformed def fails at construction, not first play
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
      const cooldown = this.cooldownSlots.get(id);
      if (cooldown?.running) return { ok: false, reason: "cooldown" };
      const result = this.activate(def, false);
      if (result.ok) this.armCooldown(def);
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
      this.cancelActivation(lane, activation);
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
        this.cancelActivation(lane, activation);
      }
    });
  }

  /** Seconds remaining on `id`'s cooldown. 0 when ready. Throws for an unknown id. */
  cooldownRemaining(id: string): number {
    const def = this.mustGetDef(id);
    const slot = this.cooldownSlots.get(id);
    if (!slot || slot.completed) return 0;
    return Math.max(0, (def.cooldown ?? 0) - slot.elapsed);
  }

  /** Cooldown progress ratio 0..1 (elapsed / cooldown). 1 when ready. Throws for an unknown id. */
  cooldownRatio(id: string): number {
    this.mustGetDef(id);
    const slot = this.cooldownSlots.get(id);
    if (!slot || slot.completed) return 1;
    return slot.ratio;
  }

  override onDestroy(): void {
    this.cancelAll();
  }

  /**
   * The one activation rule, shared by `play` and `force`: idle lane always
   * proceeds; a busy lane restarts on the same forced def, interrupts on
   * strictly higher priority, otherwise refuses.
   *
   * Loops instead of contesting the lane once: `cancelActivation` runs the
   * loser's exit hooks, and an exit hook can itself `play`/`force` a
   * replacement into this same lane before this call resumes (an
   * interrupt-from-inside-cancel). Re-reading `this.lanes.get(lane)` after
   * every cancellation re-applies the rule against whatever is actually
   * there now, so `def` gets contested against the real current occupant
   * instead of blindly overwriting it — every occupant that loses goes
   * through `cancelActivation` and gets exactly one `AbilityEnded`. A
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
      if (!restart && !interrupt) return { ok: false, reason: "busy" };
      this.cancelActivation(lane, active);
    }
  }

  /** Compile `def`'s timeline into a fresh activation and run it in `lane`. */
  private start(
    def: AbilityDef,
    lane: string,
    forced: boolean,
  ): ActivationHandle {
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
        this.runEntry(() => this.finishLane(lane, activation, false)),
    });
    this.lanes.set(lane, activation);
    this.pc.run(activation.process);
    this.enqueue(() => this.entity.emit(AbilityStarted, { activation }));
    return activation;
  }

  /** Cancel `activation`'s process and close its lane out. Shared by `cancel`/`cancelAll` and interrupts inside `activate`. */
  private cancelActivation(lane: string, activation: ActivationHandle): void {
    activation.process.cancel();
    this.finishLane(lane, activation, true);
  }

  /**
   * Natural completion and cancellation share this: close `activation`'s
   * open windows, then clear it from `lane`, flip its state, and queue its
   * `AbilityEnded` — but only if it's still the lane's current activation.
   * Checked twice: once at entry (a `finishLane` reached via a stale
   * closure, e.g. `onComplete` on a process already replaced by an
   * interrupt, is a no-op), and again after `closeOpenWindows`.
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
    cancelled: boolean,
  ): void {
    if (this.lanes.get(lane) !== activation) return;
    this.closeOpenWindows(activation, cancelled);
    if (this.lanes.get(lane) !== activation) return;
    this.lanes.delete(lane);
    activation.finish(cancelled);
    this.enqueue(() =>
      this.entity.emit(AbilityEnded, { activation, cancelled }),
    );
  }

  private closeOpenWindows(
    activation: ActivationHandle,
    cancelled: boolean,
  ): void {
    if (activation.openWindows.size === 0) return;
    for (const step of activation.def.timeline) {
      if (isWindowStep(step) && activation.openWindows.delete(step)) {
        step.hooks.exit?.(step.params, activation.ctx, cancelled);
      }
    }
  }

  /**
   * Wrap one public entry point — `play`/`force`/`cancel`/`cancelAll`, and
   * the process `onComplete` path — so lifecycle events queued during it (by
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

  private armCooldown(def: AbilityDef): void {
    const cooldown = def.cooldown ?? 0;
    if (cooldown <= 0) return;
    let slot = this.cooldownSlots.get(def.id);
    if (!slot) {
      slot = this.pc.slot({ duration: cooldown });
      this.cooldownSlots.set(def.id, slot);
    }
    slot.start();
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

      events.push({
        time: step.from,
        priority: 1,
        order,
        run: (activation) => {
          activation.openWindows.add(step);
          step.hooks.enter?.(step.params, activation.ctx);
        },
      });
      events.push({
        time: step.to,
        priority: 0,
        order,
        run: (activation) => {
          activation.openWindows.delete(step);
          step.hooks.exit?.(step.params, activation.ctx, false);
        },
      });
      if (step.every !== undefined) {
        const every = step.every;
        for (let k = 1; step.from + k * every < step.to; k++) {
          const time = step.from + k * every;
          events.push({
            time,
            priority: 1,
            order,
            run: (activation) => step.hooks.tick?.(step.params, activation.ctx),
          });
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
      if (step.to <= step.from) {
        throw new Error(
          `Abilities: ability "${def.id}" step "${step.kind}" (step #${index}) has to=${step.to} <= from=${step.from}.`,
        );
      }
      if (step.every !== undefined && step.every <= 0) {
        throw new Error(
          `Abilities: ability "${def.id}" step "${step.kind}" (step #${index}) has every=${step.every} <= 0.`,
        );
      }
      maxEnd = Math.max(maxEnd, step.to);
    }
  });

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
