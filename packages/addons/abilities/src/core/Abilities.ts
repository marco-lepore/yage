import { Component, ProcessComponent, createKeyframeTrack } from "@yagejs/core";
import type { Keyframe, Process, ProcessSlot } from "@yagejs/core";
import type {
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

/**
 * A compiled event in a timeline, ordered for deterministic same-time
 * firing. `run` is pure — it takes the `Activation` it belongs to, so the
 * same compiled event can run against successive activations of the same
 * def (see `Abilities.getCompiled`).
 */
interface CompiledEvent {
  time: number;
  /** Lower fires first at equal `time`: exits (0) before fires/enters/ticks (1). */
  priority: number;
  /** Original position of the owning step in `def.timeline` — final tie-break. */
  order: number;
  run: (activation: Activation) => void;
}

interface CompiledAbility {
  duration: number;
  events: CompiledEvent[];
}

/** One lane's live activation: the def it's running, its context, and its process/open-window bookkeeping. */
interface Activation {
  def: AbilityDef;
  ctx: StepContext;
  process: Process;
  openWindows: Set<WindowStep>;
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
 */
export class Abilities extends Component {
  private readonly pc = this.sibling(ProcessComponent);
  private readonly defsById = new Map<string, AbilityDef>();
  private readonly compiledByDef = new WeakMap<AbilityDef, CompiledAbility>();
  private readonly cooldownSlots = new Map<string, ProcessSlot>();
  private readonly lanes = new Map<string, Activation>();

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

  /**
   * Start an ability by id. Refused (no effect) if its lane is busy with a
   * def it cannot take, or if `id`'s cooldown hasn't elapsed — see
   * `PlayResult` for the reason. Throws for an unknown id — that's a
   * programmer error, not a runtime condition to check for.
   */
  play(id: string): PlayResult {
    const def = this.mustGetDef(id);
    const cooldown = this.cooldownSlots.get(id);
    if (cooldown?.running) return { ok: false, reason: "cooldown" };
    const result = this.activate(def, false);
    if (result.ok) this.armCooldown(def);
    return result;
  }

  /**
   * Force-activate `def`, bypassing cooldown entirely (there is none to
   * check or arm — forced defs are typically built fresh per hit, not
   * registered). Same activation rule as `play` — see `PlayResult` for the
   * refusal reason. `def` is validated the same way a constructor def is,
   * throwing on a malformed timeline.
   */
  force(def: AbilityDef): PlayResult {
    this.getCompiled(def);
    return this.activate(def, true);
  }

  /** Stop the lane's active ability, closing its open windows with `cancelled=true`. No-op when idle. Defaults to the `"main"` lane. */
  cancel(lane = "main"): void {
    const activation = this.lanes.get(lane);
    if (!activation) return;
    this.cancelActivation(lane, activation);
  }

  /** Stop every lane's active ability. Used by `onDestroy`. */
  cancelAll(): void {
    for (const [lane, activation] of [...this.lanes]) {
      this.cancelActivation(lane, activation);
    }
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
   */
  private activate(def: AbilityDef, forced: boolean): PlayResult {
    const lane = def.lane ?? "main";
    const active = this.lanes.get(lane);
    if (active) {
      const restart = forced && active.def === def;
      const interrupt = (def.priority ?? 0) > (active.def.priority ?? 0);
      if (!restart && !interrupt) return { ok: false, reason: "busy" };
      this.cancelActivation(lane, active);
    }
    this.start(def, lane);
    return { ok: true };
  }

  /** Compile `def`'s timeline into a fresh activation and run it in `lane`. */
  private start(def: AbilityDef, lane: string): void {
    const compiled = this.getCompiled(def);
    // `process` is filled in below once createKeyframeTrack returns it — the
    // keyframe events close over this same object, not over `process`
    // directly, so the two-step build is safe.
    const activation = {
      def,
      ctx: { entity: this.entity, def, abilities: this },
      openWindows: new Set<WindowStep>(),
    } as unknown as Activation;

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
      onComplete: () => this.finishLane(lane, activation, false),
    });
    this.lanes.set(lane, activation);
    this.pc.run(activation.process);
  }

  /** Cancel `activation`'s process and close its lane out. Shared by `cancel`/`cancelAll` and interrupts inside `activate`. */
  private cancelActivation(lane: string, activation: Activation): void {
    activation.process.cancel();
    this.finishLane(lane, activation, true);
  }

  /**
   * Natural completion and cancellation share this: close `activation`'s
   * open windows, then clear it from `lane` — but only if it's still the
   * lane's current activation (a `finish` reached via a stale closure, e.g.
   * `onComplete` on a process already replaced by an interrupt, is a no-op).
   */
  private finishLane(
    lane: string,
    activation: Activation,
    cancelled: boolean,
  ): void {
    if (this.lanes.get(lane) !== activation) return;
    this.closeOpenWindows(activation, cancelled);
    this.lanes.delete(lane);
  }

  private closeOpenWindows(activation: Activation, cancelled: boolean): void {
    if (activation.openWindows.size === 0) return;
    for (const step of activation.def.timeline) {
      if (isWindowStep(step) && activation.openWindows.delete(step)) {
        step.hooks.exit?.(step.params, activation.ctx, cancelled);
      }
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
   * Each `CompiledEvent.run` takes the `Activation` it should act against —
   * `start` wraps each one with the identity guard described there.
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
 */
function resolveDuration(def: AbilityDef): number {
  let maxEnd = 0;
  def.timeline.forEach((step, index) => {
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
