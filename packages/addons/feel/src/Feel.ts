import {
  Component,
  ErrorBoundaryKey,
  RandomKey,
  type ErrorBoundary,
  type RandomService,
  type ServiceKey,
} from "@yagejs/core";
import {
  FeelCompletedEvent,
  FeelStartedEvent,
  FeelStoppedEvent,
} from "./core/events.js";
import type {
  FeelCue,
  FeelCueMap,
  FeelCueOptions,
  FeelEffectContext,
  FeelEffectInstance,
  FeelNode,
  FeelOverlap,
  FeelPlaybackHandle,
  FeelPlayOptions,
  FeelRange,
  ScheduledFeelEffect,
} from "./core/types.js";

interface ResolvedCue {
  effect: FeelNode;
  overlap: FeelOverlap;
  chance: number;
  cooldown: number;
  intensity: FeelRange;
}

interface LiveEntry extends ScheduledFeelEffect {
  instance: FeelEffectInstance | null;
  started: boolean;
  creating: boolean;
  done: boolean;
}

class Playback implements FeelPlaybackHandle {
  private _active = true;
  private resolveFinished!: () => void;
  readonly finished = new Promise<void>((resolve) => {
    this.resolveFinished = resolve;
  });

  constructor(
    readonly cue: string,
    private readonly stopPlayback: (playback: Playback) => void,
  ) {}

  get active(): boolean {
    return this._active;
  }

  stop(): void {
    if (this._active) this.stopPlayback(this);
  }

  complete(): void {
    if (!this._active) return;
    this._active = false;
    this.resolveFinished();
  }
}

interface LivePlayback {
  handle: Playback;
  elapsed: number;
  duration: number;
  entries: LiveEntry[];
  context: FeelEffectContext;
  cancelling: boolean;
}

/**
 * Plays named, composable game-feel cues on one entity.
 *
 * Cues are transient and code-authored. Disabling or destroying this
 * component stops every live cue and restores its active effects.
 */
export class Feel extends Component {
  static updatePriority = 100;

  private readonly cues = new Map<string, ResolvedCue>();
  private readonly active = new Set<LivePlayback>();
  private readonly lastPlayedAt = new Map<string, number>();
  private clock = 0;
  private random: RandomService | undefined;
  private boundary: ErrorBoundary | undefined;
  private attached = false;

  constructor(cues: FeelCueMap) {
    super();
    for (const [name, cue] of Object.entries(cues)) {
      this.cues.set(name, resolveCue(name, cue));
    }
  }

  onAdd(): void {
    this.attached = true;
    this.random = this.use(RandomKey);
    this.boundary = this.context.tryResolve(ErrorBoundaryKey);
  }

  /** Start one named cue. Returns `null` when dormant or rejected by its trigger policy. */
  play(name: string, options?: FeelPlayOptions): FeelPlaybackHandle | null {
    const cue = this.cues.get(name);
    if (!cue) {
      throw new Error(`Feel: unknown cue "${name}".`);
    }
    if (!this.attached || !this.effectiveEnabled) return null;
    const random = this.random ?? this.use(RandomKey);
    const lastPlayed = this.lastPlayedAt.get(name);
    if (lastPlayed !== undefined && this.clock - lastPlayed < cue.cooldown) {
      return null;
    }

    const sameCue = [...this.active].filter(
      (playback) => playback.handle.cue === name,
    );
    if (sameCue.length > 0) {
      if (cue.overlap === "ignore") return null;
    }
    if (cue.chance < 1 && random.float() >= cue.chance) return null;
    if (cue.overlap === "restart") {
      for (const playback of sameCue) this.cancel(playback);
    }

    const intensity = options?.intensity ?? resolveRange(cue.intensity, random);
    if (!Number.isFinite(intensity) || intensity < 0) {
      throw new Error(
        `Feel.play("${name}"): intensity must be a finite number >= 0, got ${intensity}.`,
      );
    }

    const scheduled: ScheduledFeelEffect[] = [];
    cue.effect._schedule(0, scheduled);
    scheduled.sort((a, b) => a.at - b.at);

    const handle = new Playback(name, (playback) => {
      const live = [...this.active].find((entry) => entry.handle === playback);
      if (live) this.cancel(live);
    });
    const context = this.makeContext(name, intensity, random);
    const live: LivePlayback = {
      handle,
      elapsed: 0,
      duration: cue.effect.duration,
      context,
      cancelling: false,
      entries: scheduled.map((entry) => ({
        ...entry,
        instance: null,
        started: false,
        creating: false,
        done: false,
      })),
    };
    this.active.add(live);
    this.lastPlayedAt.set(name, this.clock);
    this.entity.emit(FeelStartedEvent, { cue: name, playback: handle });
    this.advance(live, 0);
    return handle;
  }

  /** Stop all live plays of one cue, or every cue when `name` is omitted. */
  stop(name?: string): void {
    for (const playback of [...this.active]) {
      if (name === undefined || playback.handle.cue === name) {
        this.cancel(playback);
      }
    }
  }

  /** Whether at least one accepted playback is active. */
  isPlaying(name?: string): boolean {
    if (name === undefined) return this.active.size > 0;
    for (const playback of this.active) {
      if (playback.handle.cue === name) return true;
    }
    return false;
  }

  update(dt: number): void {
    this.clock += dt;
    for (const playback of [...this.active]) this.advance(playback, dt);
  }

  onDisable(): void {
    this.stop();
  }

  onDestroy(): void {
    this.attached = false;
    this.stop();
  }

  private makeContext(
    cue: string,
    intensity: number,
    random: RandomService,
  ): FeelEffectContext {
    return {
      entity: this.entity,
      cue,
      intensity,
      random,
      resolve: <T>(key: ServiceKey<T>): T => this.use(key),
      invoke: (label, callback) => {
        const boundary = this.boundary;
        if (!boundary) {
          callback();
          return;
        }
        boundary.wrapCallback(callback, {
          kind: `Feel callback (${label})`,
          entity: this.entity.name,
          ...(this.entity.tryScene ? { scene: this.entity.tryScene.name } : {}),
        });
      },
    };
  }

  private advance(playback: LivePlayback, dt: number): void {
    if (!playback.handle.active) return;
    const previous = playback.elapsed;
    playback.elapsed += dt;
    const context = playback.context;

    for (const entry of playback.entries) {
      if (entry.done || playback.elapsed < entry.at) continue;
      if (!entry.started) {
        entry.started = true;
        entry.creating = true;
        const result: { instance?: FeelEffectInstance } = {};
        try {
          context.invoke("effect create", () => {
            result.instance = entry.definition.create(context);
          });
        } finally {
          entry.creating = false;
          if (playback.cancelling && result.instance === undefined) {
            this.finishCancellation(playback);
          }
        }
        const instance = result.instance;
        if (!instance) {
          throw new Error(
            "Feel: an effect factory did not return an instance.",
          );
        }
        entry.instance = instance;
        if (playback.cancelling) {
          this.finishCancellation(playback);
          return;
        }
        const start = instance.start;
        if (start) {
          context.invoke(instance.label ?? "effect start", () =>
            start.call(instance),
          );
          if (!playback.handle.active) return;
        }
      }

      const duration = entry.definition.duration;
      if (duration === 0) {
        const instance = entry.instance;
        const update = instance?.update;
        if (update) {
          context.invoke(instance.label ?? "effect update", () =>
            update.call(instance, 1, 0),
          );
          if (!playback.handle.active) return;
        }
        entry.done = true;
        const finish = instance?.finish;
        if (finish) {
          context.invoke(instance.label ?? "effect finish", () =>
            finish.call(instance, false),
          );
          if (!playback.handle.active) return;
        }
        continue;
      }

      const end = entry.at + duration;
      const activeDt = Math.max(
        0,
        Math.min(playback.elapsed, end) - Math.max(previous, entry.at),
      );
      const progress = Math.min((playback.elapsed - entry.at) / duration, 1);
      const instance = entry.instance;
      const update = instance?.update;
      if (update) {
        context.invoke(instance.label ?? "effect update", () =>
          update.call(instance, progress, activeDt),
        );
        if (!playback.handle.active) return;
      }
      if (progress >= 1) {
        entry.done = true;
        const finish = instance?.finish;
        if (finish) {
          context.invoke(instance.label ?? "effect finish", () =>
            finish.call(instance, false),
          );
          if (!playback.handle.active) return;
        }
      }
    }

    if (
      playback.elapsed >= playback.duration &&
      playback.entries.every((entry) => entry.done)
    ) {
      this.active.delete(playback);
      playback.handle.complete();
      this.entity.emit(FeelCompletedEvent, {
        cue: playback.handle.cue,
        playback: playback.handle,
      });
    }
  }

  private cancel(playback: LivePlayback): void {
    if (playback.cancelling) return;
    if (!this.active.delete(playback)) return;
    playback.cancelling = true;
    if (playback.entries.some((entry) => entry.creating)) return;
    this.finishCancellation(playback);
  }

  private finishCancellation(playback: LivePlayback): void {
    if (!playback.handle.active) return;
    for (const entry of playback.entries) {
      if (entry.started && !entry.done) {
        const instance = entry.instance;
        const finish = instance?.finish;
        if (finish) {
          playback.context.invoke(instance.label ?? "effect finish", () =>
            finish.call(instance, true),
          );
        }
        entry.done = true;
      }
    }
    playback.handle.complete();
    this.entity.emit(FeelStoppedEvent, {
      cue: playback.handle.cue,
      playback: playback.handle,
    });
  }
}

function isCueOptions(cue: FeelCue): cue is FeelCueOptions {
  return "effect" in cue;
}

function resolveCue(name: string, cue: FeelCue): ResolvedCue {
  const options: FeelCueOptions = isCueOptions(cue) ? cue : { effect: cue };
  const chance = options.chance ?? 1;
  const cooldown = options.cooldown ?? 0;
  const intensity = options.intensity ?? 1;
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new Error(`Feel cue "${name}": chance must be between 0 and 1.`);
  }
  if (!Number.isFinite(cooldown) || cooldown < 0) {
    throw new Error(
      `Feel cue "${name}": cooldown must be a finite number >= 0.`,
    );
  }
  validateRange(name, intensity);
  return {
    effect: options.effect,
    overlap: options.overlap ?? "restart",
    chance,
    cooldown,
    intensity,
  };
}

function validateRange(name: string, value: FeelRange): void {
  const values: readonly number[] = typeof value === "number" ? [value] : value;
  if (values.some((entry) => !Number.isFinite(entry) || entry < 0)) {
    throw new Error(
      `Feel cue "${name}": intensity values must be finite numbers >= 0.`,
    );
  }
  if (typeof value !== "number" && value[0] > value[1]) {
    throw new Error(`Feel cue "${name}": intensity range min exceeds max.`);
  }
}

function resolveRange(value: FeelRange, random: RandomService): number {
  return typeof value === "number" ? value : random.range(value[0], value[1]);
}
