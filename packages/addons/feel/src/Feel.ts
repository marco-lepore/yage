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
  FeelNode,
  FeelOverlap,
  FeelPlaybackHandle,
  FeelPlayOptions,
  FeelRange,
  FeelRuntimeControl,
  FeelRuntimeNode,
  FeelRuntimeTiming,
} from "./core/types.js";

interface ResolvedCue {
  effect: FeelNode;
  overlap: FeelOverlap;
  chance: number;
  cooldown: number;
  intensity: FeelRange;
}

class Playback implements FeelPlaybackHandle {
  private _active = true;
  private resolveFinished!: () => void;
  readonly finished = new Promise<void>((resolve) => {
    this.resolveFinished = resolve;
  });

  constructor(
    readonly cue: string,
    private readonly releasePlayback: () => void,
    private readonly stopPlayback: () => void,
  ) {}

  get active(): boolean {
    return this._active;
  }

  release(): void {
    if (this._active) this.releasePlayback();
  }

  stop(): void {
    if (this._active) this.stopPlayback();
  }

  complete(): void {
    if (!this._active) return;
    this._active = false;
    this.resolveFinished();
  }
}

interface LivePlayback {
  handle: Playback;
  runtime: FeelRuntimeNode;
  state: { cancelling: boolean; released: boolean };
  advancing: boolean;
}

/**
 * Plays named, composable game-feel cues on one entity.
 *
 * Cues and live playback are runtime-only. Normal entity setup constructs the
 * component when the game builds a scene. Disabling or destroying this
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

    validatePlayOptions(name, cue.effect, options);
    if (!this.attached || !this.effectiveEnabled) return null;
    const random = this.random ?? this.use(RandomKey);
    const lastPlayed = this.lastPlayedAt.get(name);
    if (lastPlayed !== undefined && this.clock - lastPlayed < cue.cooldown) {
      return null;
    }

    const sameCue = [...this.active].filter(
      (playback) => playback.handle.cue === name,
    );
    if (sameCue.length > 0 && cue.overlap === "ignore") return null;
    if (cue.chance < 1 && random.float() >= cue.chance) return null;

    const intensity = options?.intensity ?? resolveRange(cue.intensity, random);
    if (cue.overlap === "restart") {
      for (const playback of sameCue) this.cancel(playback);
    }

    const state = { cancelling: false, released: false };
    const control: FeelRuntimeControl = {
      get cancelled() {
        return state.cancelling;
      },
      get released() {
        return state.released;
      },
    };
    const handle = new Playback(
      name,
      () => this.releasePlayback(live),
      () => this.cancel(live),
    );
    const context = this.makeContext(name, intensity, random);
    const timing = createTiming(cue.effect.duration, options?.duration);
    const runtime = cue.effect._createRuntime(context, timing, control);
    const live: LivePlayback = {
      handle,
      runtime,
      state,
      advancing: false,
    };

    this.active.add(live);
    this.lastPlayedAt.set(name, this.clock);
    this.entity.emit(FeelStartedEvent, { cue: name, playback: handle });
    this.advance(live, 0);
    return handle;
  }

  /** Gracefully release all live plays of one cue, or every cue when `name` is omitted. */
  release(name?: string): void {
    for (const playback of [...this.active]) {
      if (name === undefined || playback.handle.cue === name) {
        this.releasePlayback(playback);
      }
    }
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
      duration: null,
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
    if (!playback.handle.active || playback.state.cancelling) return;
    playback.advancing = true;
    try {
      if (playback.state.released) playback.runtime.release();
      playback.runtime.advance(dt);
      if (playback.state.cancelling) return;
      if (playback.state.released) playback.runtime.release();
      if (playback.runtime.timelineComplete && playback.runtime.complete) {
        this.complete(playback);
      }
    } finally {
      playback.advancing = false;
      if (playback.state.cancelling) this.finishCancellation(playback);
    }
  }

  private releasePlayback(playback: LivePlayback): void {
    if (
      !playback.handle.active ||
      playback.state.released ||
      playback.state.cancelling
    ) {
      return;
    }
    playback.state.released = true;
    if (playback.advancing) return;
    playback.runtime.release();
    if (playback.runtime.timelineComplete && playback.runtime.complete) {
      this.complete(playback);
    }
  }

  private complete(playback: LivePlayback): void {
    if (!this.active.delete(playback)) return;
    playback.handle.complete();
    this.entity.emit(FeelCompletedEvent, {
      cue: playback.handle.cue,
      playback: playback.handle,
    });
  }

  private cancel(playback: LivePlayback): void {
    if (playback.state.cancelling || !playback.handle.active) return;
    playback.state.cancelling = true;
    this.active.delete(playback);
    if (!playback.advancing) this.finishCancellation(playback);
  }

  private finishCancellation(playback: LivePlayback): void {
    if (!playback.handle.active) return;
    playback.runtime.cancel();
    playback.handle.complete();
    this.entity.emit(FeelStoppedEvent, {
      cue: playback.handle.cue,
      playback: playback.handle,
    });
  }
}

function createTiming(
  authoredDuration: number | null,
  durationOverride: number | undefined,
): FeelRuntimeTiming {
  if (
    durationOverride === undefined ||
    authoredDuration === null ||
    durationOverride === authoredDuration
  ) {
    return {
      scale: (seconds) => seconds,
      toLocalDelta: (seconds) => seconds,
    };
  }
  if (authoredDuration === 0) {
    return {
      scale: () => 0,
      toLocalDelta: () => 0,
    };
  }
  return {
    scale: (seconds) => (seconds / authoredDuration) * durationOverride,
    toLocalDelta: (seconds) =>
      durationOverride === 0
        ? 0
        : (seconds / durationOverride) * authoredDuration,
  };
}

function validatePlayOptions(
  name: string,
  effect: FeelNode,
  options: FeelPlayOptions | undefined,
): void {
  const intensity = options?.intensity;
  if (
    intensity !== undefined &&
    (!Number.isFinite(intensity) || intensity < 0)
  ) {
    throw new Error(
      `Feel.play("${name}"): intensity must be a finite number >= 0, got ${intensity}.`,
    );
  }
  const duration = options?.duration;
  if (duration === undefined) return;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(
      `Feel.play("${name}"): duration must be a finite number >= 0, got ${duration}.`,
    );
  }
  if (effect.duration === null) {
    throw new Error(
      `Feel.play("${name}"): duration cannot override a cue that needs release or source completion.`,
    );
  }
  if (effect.duration === 0 && duration > 0) {
    throw new Error(
      `Feel.play("${name}"): a zero-duration cue cannot be stretched to ${duration}.`,
    );
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
