import {
  globalRandom,
  type RandomService,
  type ErrorBoundary,
} from "@yagejs/core";
import { SoundHandle } from "./SoundHandle.js";
import {
  getSound,
  getSoundMetadata as registeredMetadata,
  type SoundMetadata,
} from "./assets.js";
import { AudioTimeline } from "./AudioTimeline.js";
import { automationTiming } from "./internal/Automation.js";
import {
  assertFadeDuration,
  assertPan,
  assertPositive,
  assertSpeed,
  assertTime,
  assertVolume,
} from "./internal/validation.js";
import type {
  AudioAutomationOptions,
  AudioConfig,
  AudioCrossfadeOptions,
  AudioDiagnostics,
  AudioPlayOptions,
  ChannelConfig,
  SoundRef,
  SoundRequestHandle,
  SoundRequestReleaseOptions,
} from "./types.js";
interface SoundRequestState {
  active: boolean;
  released: boolean;
  readonly onEnd: (() => void) | undefined;
}
interface SharedPlaybackState {
  readonly alias: string;
  readonly handle: SoundHandle;
  readonly requests: Set<SoundRequestState>;
  playOnceOwned: boolean;
  playOnceOnEnd: (() => void) | undefined;
}
interface ChannelState {
  muted: boolean;
  paused: boolean;
  pauseAt: number | undefined;
  parent: string | undefined;
  node: GainNode;
  mute: GainNode;
  automation: AudioTimeline;
  handles: Set<SoundHandle>;
  shared: Map<string, SharedPlaybackState>;
  pauseListeners: Set<(paused: boolean) => void>;
}
const aliasOf = (ref: SoundRef): string =>
  typeof ref === "string" ? ref : ref.path;

/**
 * Plays sounds through named channels on one Web Audio context. `AudioPlugin`
 * creates the live manager; resolve it with `this.use(AudioManagerKey)`.
 * `renderAudio` creates one over an offline context.
 */
export class AudioManager {
  private readonly _channels = new Map<string, ChannelState>();
  private readonly _random: RandomService;
  private readonly master: GainNode;
  private _masterVolume: number;
  private _autoPause: boolean;
  private hostActive = true;
  private holding = false;
  private _errorBoundary: ErrorBoundary | undefined;
  private readonly unlockListeners = new Set<() => void>();
  /**
   * Runs the pending `onUnlock` listeners once the context is running. The
   * context reports every transition: the resume after the first gesture,
   * and the resume after a hold for an inactive host.
   */
  private readonly onStateChange = (): void => {
    if (!this.isUnlocked()) return;
    for (const callback of this.unlockListeners) {
      this.unlockListeners.delete(callback);
      this._runCallback(callback, "Audio unlock callback");
    }
  };
  private readonly schedulers = new Set<
    (now: number, horizon: number) => void
  >();
  private nextId = 1;
  private disposed = false;
  private lateStarts = 0;
  private readonly failures: Array<{ operation: string; message: string }> = [];
  /** Seconds ahead of `currentTime` that schedulers book sounds. Default 0.12. */
  readonly lookahead: number;
  /** Seconds between scheduler ticks. Default 0.025. */
  readonly tickInterval: number;

  constructor(
    private readonly context: BaseAudioContext,
    config: AudioConfig = {},
    random: RandomService = globalRandom,
  ) {
    assertVolume("AudioManager.masterVolume", config.masterVolume ?? 1);
    this.lookahead = config.lookahead ?? 0.12;
    this.tickInterval = config.tickInterval ?? 0.025;
    assertPositive("AudioManager.lookahead", this.lookahead);
    assertPositive("AudioManager.tickInterval", this.tickInterval);
    if (this.tickInterval >= this.lookahead)
      throw new Error(
        "AudioManager: tickInterval must be shorter than lookahead.",
      );
    const definitions = {
      sfx: { volume: 1 },
      music: { volume: 0.7 },
      ...config.channels,
    };
    for (const [name, definition] of Object.entries(definitions))
      assertVolume(`AudioManager channel ${name}`, definition.volume ?? 1);
    this._random = random;
    this._masterVolume = config.masterVolume ?? 1;
    this._autoPause = config.autoPause ?? true;
    context.addEventListener("statechange", this.onStateChange);
    this.master = context.createGain();
    this.master.gain.value = this._masterVolume;
    this.master.connect(context.destination);
    for (const [name, definition] of Object.entries(definitions))
      this.createChannel(name, definition);
  }
  /** The audio clock in seconds. It stops while the context is suspended. */
  get currentTime(): number {
    return this.context.currentTime;
  }
  /** Output samples per second of the audio context. */
  get sampleRate(): number {
    return this.context.sampleRate;
  }
  /** Volume multiplier for all playback owned by this manager. Default: 1. */
  get masterVolume(): number {
    return this._masterVolume;
  }
  set masterVolume(volume: number) {
    assertVolume("AudioManager.masterVolume", volume);
    this._masterVolume = volume;
    this.master.gain.setValueAtTime(volume, this.currentTime);
  }
  /**
   * Pause all audio while the host is inactive (`Host.active` is `false`): the
   * app is in the background, the page is hidden, or the window is unfocused.
   * Default: `true`. The audio clock stops and continues from where it
   * stopped; channel and handle volume, mute and pause stay as the game set
   * them.
   */
  get autoPause(): boolean {
    return this._autoPause;
  }
  set autoPause(value: boolean) {
    this.assertActive();
    this._autoPause = value;
    this.applyHostPause();
  }
  /**
   * Whether the audio context is running, which is when audio plays. It is
   * `false` before the first user gesture, which every browser requires;
   * while audio is held for an inactive host; and until the context has
   * resumed after the host becomes active again.
   */
  isUnlocked(): boolean {
    return this.context.state === "running";
  }
  /**
   * Whether a sound is registered under `ref`'s alias, preloaded with
   * `sound(...)` or added with `registerSound()`. `play` throws on the same
   * check, so this is the guard for an alias the game assembles at runtime.
   * It reports nothing about whether audio can be heard.
   */
  hasSound(ref: SoundRef): boolean {
    return getSound(aliasOf(ref)) !== undefined;
  }
  /**
   * A copy of the loop points and root note registered with a sound, or
   * `undefined` when nothing is registered under its alias.
   */
  getSoundMetadata(ref: SoundRef): SoundMetadata | undefined {
    return registeredMetadata(aliasOf(ref));
  }

  /**
   * Play a preloaded or registered sound. Accepts the alias or the handle
   * `sound()` returned. Throws when the alias resolves to nothing, which is a
   * typo or playback before the asset was preloaded.
   */
  play(ref: SoundRef, options: AudioPlayOptions = {}): SoundHandle {
    return this._startPlayback(ref, options, true).handle;
  }
  /** Play one of `aliases`, picked with the manager's random service. */
  playRandom(aliases: SoundRef[], options?: AudioPlayOptions): SoundHandle {
    if (!aliases.length)
      throw new Error("AudioManager.playRandom: aliases must not be empty.");
    return this.play(this._random.pick(aliases), options);
  }
  /**
   * Start `next` at zero volume and fade it to `options.volume` (default 1)
   * while `outgoing` fades to zero and stops. Both fades are linear and share
   * `options.at`. Returns the incoming handle.
   */
  crossfade(
    outgoing: SoundHandle,
    next: SoundRef,
    options: AudioCrossfadeOptions,
  ): SoundHandle {
    if (!outgoing.playing)
      throw new Error("AudioManager.crossfade: outgoing sound has finished.");
    if (!this._channels.get(outgoing.channel)?.handles.has(outgoing))
      throw new Error(
        "AudioManager.crossfade: outgoing handle does not belong to this manager.",
      );
    assertFadeDuration("AudioManager.crossfade", options.duration);
    const target = options.volume ?? 1;
    assertVolume("AudioManager.crossfade", target);
    const now = this.currentTime;
    if (options.at !== undefined && options.at < now)
      throw new Error(
        `AudioManager.crossfade: at must be at or after audio time ${now}, got ${options.at}.`,
      );
    const { at } = automationTiming("AudioManager.crossfade", now, options);
    const incoming = this.play(next, {
      ...options,
      channel: options.channel ?? outgoing.channel,
      volume: 0,
    });
    incoming.fadeTo(target, { at, duration: options.duration });
    outgoing.fadeTo(0, {
      at,
      duration: options.duration,
      stopOnComplete: true,
    });
    return incoming;
  }
  /** Stop one sound now. */
  stop(handle: SoundHandle): void {
    handle.stop();
  }
  /** Stop every sound in a channel and its child channels, now or at audio time `at`. */
  stopChannel(channel: string, at?: number): void {
    if (at !== undefined) assertTime("AudioManager.stopChannel.at", at);
    for (const state of this.descendants(channel))
      for (const handle of [...state.handles]) handle.stop(at);
  }
  /** Stop every sound of this manager. */
  stopAll(): void {
    for (const channel of this._channels.values())
      for (const handle of [...channel.handles]) handle.stop();
  }
  /** Fresh snapshot of configured and created channels, in creation order. */
  getChannelNames(): readonly string[] {
    return [...this._channels.keys()];
  }
  /**
   * Add a channel, optionally mixed through an existing `parent` channel.
   * Throws for an empty or existing name or an unknown parent.
   */
  createChannel(name: string, config: ChannelConfig = {}): void {
    this.assertActive();
    if (!name.trim() || this._channels.has(name))
      throw new Error(
        `AudioManager.createChannel: channel "${name}" is empty or already exists.`,
      );
    const volume = config.volume ?? 1;
    assertVolume("AudioManager.createChannel", volume);
    const parent =
      config.parent === undefined
        ? undefined
        : this._channels.get(config.parent);
    if (config.parent !== undefined && !parent)
      throw new Error(
        `AudioManager.createChannel: unknown parent "${config.parent}".`,
      );
    const node = this.context.createGain();
    const mute = this.context.createGain();
    node.gain.value = volume;
    node.connect(mute);
    mute.connect(parent?.node ?? this.master);
    this._channels.set(name, {
      parent: config.parent,
      node,
      mute,
      automation: new AudioTimeline(volume),
      muted: false,
      paused: false,
      pauseAt: undefined,
      handles: new Set(),
      shared: new Map(),
      pauseListeners: new Set(),
    });
    this.reconcilePauses();
  }
  /** Observe effective channel pause, including parent pause. Called immediately and on changes. */
  onChannelPause(
    name: string,
    callback: (paused: boolean) => void,
  ): () => void {
    const state = this._ensureChannel(name);
    state.pauseListeners.add(callback);
    this._runCallback(
      () => callback(state.pauseAt !== undefined),
      "Audio channel pause callback",
    );
    return () => state.pauseListeners.delete(callback);
  }
  /** Stop and remove a channel and every child channel. */
  removeChannel(name: string): void {
    this.stopChannel(name);
    for (const [key, channel] of [...this._channels].reverse())
      if (this.belongsTo(key, name)) {
        channel.node.disconnect();
        channel.mute.disconnect();
        this._channels.delete(key);
      }
  }
  /**
   * Set a channel's volume now or ramp it with automation options. Creates an
   * unknown channel. A paused channel keeps the ramp for when it resumes.
   */
  setChannelVolume(
    name: string,
    volume: number,
    options?: AudioAutomationOptions,
  ): void {
    assertVolume("AudioManager.setChannelVolume", volume);
    const { at, duration, curve } = automationTiming(
      "AudioManager.setChannelVolume",
      this.currentTime,
      options,
    );
    const state = this._ensureChannel(name);
    const effectiveAt =
      state.pauseAt === undefined
        ? at
        : at - (this.currentTime - state.pauseAt);
    state.automation.set(volume, effectiveAt, duration, curve);
    state.automation.prune(state.pauseAt ?? this.currentTime);
    if (state.pauseAt === undefined)
      state.automation.apply(state.node.gain, this.currentTime);
  }
  /** The channel's current volume. Unknown channels report 1; reading does not create them. */
  getChannelVolume(name: string): number {
    const state = this._channels.get(name);
    return state?.automation.valueAt(state.pauseAt ?? this.currentTime) ?? 1;
  }
  /** Silence a channel without changing its volume. */
  muteChannel(name: string): void {
    const state = this._ensureChannel(name);
    state.muted = true;
    state.mute.gain.setValueAtTime(0, this.currentTime);
  }
  /** Undo `muteChannel`. */
  unmuteChannel(name: string): void {
    const state = this._ensureChannel(name);
    state.muted = false;
    state.mute.gain.setValueAtTime(1, this.currentTime);
  }
  /**
   * Pause a channel and its children. Sounds keep their position and remaining
   * fades, and pause-aware sequencers such as the music addon hold their beat.
   */
  pauseChannel(name: string): void {
    this._ensureChannel(name).paused = true;
    this.reconcilePauses();
  }
  /** Undo `pauseChannel`. A child stays paused while its own pause or a parent's holds. */
  resumeChannel(name: string): void {
    this._ensureChannel(name).paused = false;
    this.reconcilePauses();
  }
  /** Mute every channel. */
  muteAll(): void {
    for (const name of this._channels.keys()) this.muteChannel(name);
  }
  /** Unmute every channel. */
  unmuteAll(): void {
    for (const name of this._channels.keys()) this.unmuteChannel(name);
  }

  /**
   * Call `callback` once audio is running: now if it already is, otherwise
   * when the context next starts running, after the first user gesture or
   * when audio held for an inactive host resumes. Returns a disposer.
   */
  onUnlock(callback: () => void): () => void {
    if (this.isUnlocked()) this._runCallback(callback, "Audio unlock callback");
    else this.unlockListeners.add(callback);
    return () => this.unlockListeners.delete(callback);
  }
  /** Remove a listener registered with `onUnlock`. */
  offUnlock(callback: () => void): void {
    this.unlockListeners.delete(callback);
  }
  /** Subscribe to engine-owned lookahead ticks, independent of scene/game time. */
  addScheduler(callback: (now: number, horizon: number) => void): () => void {
    this.assertActive();
    this.schedulers.add(callback);
    return () => this.schedulers.delete(callback);
  }
  /** Advance booked work. AudioPlugin calls this on its timer; offline plans call it explicitly. */
  updateSchedule(now = this.currentTime, horizon = now + this.lookahead): void {
    assertTime("AudioManager.updateSchedule.now", now);
    assertTime("AudioManager.updateSchedule.horizon", horizon);
    if (horizon < now)
      throw new Error("AudioManager.updateSchedule: horizon must be >= now.");
    this.assertActive();
    for (const callback of this.schedulers)
      this._runCallback(
        () => callback(now, horizon),
        "Audio scheduler callback",
      );
  }
  /**
   * Context state, clock, voice counts, scheduler count, late starts, channels
   * and the most recent callback failures. The Inspector `audio` extension
   * returns the same data.
   */
  getDiagnostics(): AudioDiagnostics {
    const channels = [...this._channels];
    const handles = channels.flatMap(([, c]) => [...c.handles]);
    return {
      state: this.context.state,
      currentTime: this.currentTime,
      activeVoices: handles.length,
      scheduledVoices: handles.filter((h) => h.scheduled).length,
      schedulerCount: this.schedulers.size,
      lateStarts: this.lateStarts,
      channels: channels.map(([name, c]) => ({
        name,
        volume: this.getChannelVolume(name),
        muted: c.muted,
        paused: c.paused,
        voices: c.handles.size,
      })),
      failures: this.failures.map((f) => ({ ...f })),
    };
  }
  /** Follow the host's activity. @internal */
  _setHostActive(active: boolean): void {
    this.hostActive = active;
    this.applyHostPause();
  }
  /** Whether audio is held for an inactive host. @internal */
  _isHeld(): boolean {
    return this.holding;
  }
  /**
   * Suspend the context while the host is inactive, and resume it when the
   * hold ends. The resume runs even when the context was not running as the
   * hold began: a resume or a gesture can still be pending then. The browser
   * keeps a context no gesture has unlocked suspended, and the resume then
   * waits for that gesture. Only `AudioPlugin`'s live `AudioContext` reports
   * host activity, so the context here is never an offline one.
   */
  private applyHostPause(): void {
    const hold = this._autoPause && !this.hostActive;
    if (hold === this.holding) return;
    this.holding = hold;
    const context = this.context as AudioContext;
    if (hold) {
      void context.suspend().catch((error: unknown) => {
        this._reportFailure("Audio suspend", error);
        throw error;
      });
    } else {
      void context.resume().catch((error: unknown) => {
        this._reportFailure("Audio resume", error);
        throw error;
      });
    }
  }
  /** @internal */
  _setErrorBoundary(boundary: ErrorBoundary | undefined): void {
    this._errorBoundary = boundary;
  }
  /** @internal */
  _reportFailure(operation: string, error: unknown): void {
    this.failures.push({
      operation,
      message: error instanceof Error ? error.message : String(error),
    });
    if (this.failures.length > 50) this.failures.shift();
    this._errorBoundary?.reportLifecycleError(error, { kind: operation });
  }
  /** Stop every sound and disconnect every node. `AudioPlugin` calls it on destroy. */
  dispose(): void {
    if (this.disposed) return;
    this.stopAll();
    this.schedulers.clear();
    this.unlockListeners.clear();
    this.context.removeEventListener("statechange", this.onStateChange);
    for (const state of this._channels.values()) {
      state.node.disconnect();
      state.mute.disconnect();
    }
    this._channels.clear();
    this.master.disconnect();
    this.disposed = true;
  }
  private assertActive(): void {
    if (this.disposed) throw new Error("AudioManager: manager is disposed.");
  }
  private _runCallback(callback: () => void, kind: string): void {
    try {
      if (this._errorBoundary)
        this._errorBoundary.wrapCallback(callback, { kind });
      else callback();
    } catch (error) {
      this.failures.push({
        operation: kind,
        message: error instanceof Error ? error.message : String(error),
      });
      if (this.failures.length > 50) this.failures.shift();
      throw error;
    }
  }
  private _ensureChannel(name: string): ChannelState {
    this.assertActive();
    if (!this._channels.has(name)) this.createChannel(name);
    return this._channels.get(name)!;
  }
  private belongsTo(name: string, parent: string): boolean {
    let current: string | undefined = name;
    while (current !== undefined) {
      if (current === parent) return true;
      current = this._channels.get(current)?.parent;
    }
    return false;
  }
  private descendants(name: string): ChannelState[] {
    return [...this._channels]
      .filter(([key]) => this.belongsTo(key, name))
      .map(([, state]) => state);
  }
  private isChannelPaused(name: string): boolean {
    let state = this._channels.get(name);
    while (state) {
      if (state.paused) return true;
      state =
        state.parent === undefined
          ? undefined
          : this._channels.get(state.parent);
    }
    return false;
  }
  private reconcilePauses(): void {
    for (const [name, state] of this._channels) {
      const paused = this.isChannelPaused(name);
      const changed = paused !== (state.pauseAt !== undefined);
      if (paused && state.pauseAt === undefined) {
        state.pauseAt = this.currentTime;
        const value = state.automation.valueAt(this.currentTime);
        state.node.gain.cancelScheduledValues(this.currentTime);
        state.node.gain.setValueAtTime(value, this.currentTime);
      } else if (!paused && state.pauseAt !== undefined) {
        state.automation.shift(state.pauseAt, this.currentTime - state.pauseAt);
        state.pauseAt = undefined;
        state.automation.apply(state.node.gain, this.currentTime);
      }
      for (const handle of state.handles) handle._setChannelPaused(paused);
      if (changed)
        for (const callback of state.pauseListeners)
          this._runCallback(
            () => callback(paused),
            "Audio channel pause callback",
          );
    }
  }
  private _startPlayback(
    ref: SoundRef,
    options: AudioPlayOptions = {},
    attachOnEnd: boolean,
  ) {
    this.assertActive();
    const alias = aliasOf(ref);
    const buffer = getSound(alias);
    if (!buffer)
      throw new Error(
        `AudioManager.play: no sound registered as "${alias}". Preload sound(...) or registerSound().`,
      );
    const { loopStart, loopEnd } = registeredMetadata(alias)!;
    options =
      options.loop && loopStart !== undefined && loopEnd !== undefined
        ? { loopStart, loopEnd, ...options }
        : { ...options };
    validatePlay(options, buffer.duration);
    const channelName = options.channel ?? "sfx";
    const channel = this._ensureChannel(channelName);
    if (options.at !== undefined && options.at < this.currentTime)
      this.lateStarts++;
    const handle = new SoundHandle(
      this.nextId++,
      channelName,
      alias,
      this.context,
      buffer,
      options,
      channel.node,
    );
    channel.handles.add(handle);
    handle._onFinish(() => channel.handles.delete(handle));
    if (attachOnEnd && options.onEnd)
      handle._onFinish((natural) => {
        if (natural) this._runCallback(options.onEnd!, "Audio onEnd callback");
      });
    if (this.isChannelPaused(channelName)) handle._setChannelPaused(true);
    return { alias, channel, handle };
  }
  private _startSharedPlayback(
    ref: SoundRef,
    options?: AudioPlayOptions,
  ): SharedPlaybackState {
    const started = this._startPlayback(ref, options, false);
    const playback: SharedPlaybackState = {
      alias: started.alias,
      handle: started.handle,
      requests: new Set(),
      playOnceOwned: false,
      playOnceOnEnd: undefined,
    };
    started.channel.shared.set(started.alias, playback);
    started.handle._onFinish((natural) =>
      this._finishSharedPlayback(started.channel, playback, natural),
    );
    return playback;
  }
  /**
   * Play one shared instance per alias and channel. Repeated calls retain the
   * same implicit owner, so callers may ignore the returned sound handle.
   */
  playOnce(ref: SoundRef, options?: AudioPlayOptions): SoundHandle {
    const alias = aliasOf(ref);
    const channel = this._channels.get(options?.channel ?? "sfx");
    const existing = channel?.shared.get(alias);
    if (existing) {
      if (!existing.playOnceOwned) {
        existing.playOnceOwned = true;
        existing.playOnceOnEnd = options?.onEnd;
      }
      return existing.handle;
    }

    const playback = this._startSharedPlayback(ref, options);
    playback.playOnceOwned = true;
    playback.playOnceOnEnd = options?.onEnd;
    return playback.handle;
  }

  /**
   * Own one request for playback shared by alias and channel. Releasing the
   * request stops the sound only after every request is gone and no `playOnce`
   * owner remains.
   */
  requestOnce(ref: SoundRef, options?: AudioPlayOptions): SoundRequestHandle {
    const alias = aliasOf(ref);
    const channel = this._channels.get(options?.channel ?? "sfx");
    const playback =
      channel?.shared.get(alias) ?? this._startSharedPlayback(ref, options);
    const request: SoundRequestState = {
      active: true,
      released: false,
      onEnd: options?.onEnd,
    };
    playback.requests.add(request);
    return {
      get active(): boolean {
        return request.active;
      },
      release: (options) => this._releaseRequest(playback, request, options),
    };
  }

  private _releaseRequest(
    playback: SharedPlaybackState,
    request: SoundRequestState,
    options?: SoundRequestReleaseOptions,
  ): void {
    const fadeOut = options?.fadeOut ?? 0;
    if (!Number.isFinite(fadeOut) || fadeOut < 0) {
      throw new Error(
        `SoundRequestHandle.release: fadeOut must be a finite number >= 0 in seconds, got ${fadeOut}.`,
      );
    }
    if (!request.active || request.released) return;
    const lastOwner = playback.requests.size === 1 && !playback.playOnceOwned;
    if (lastOwner && fadeOut > 0) {
      playback.handle.fadeTo(0, { duration: fadeOut, stopOnComplete: true });
      request.released = true;
      // A new owner starts at full volume while this recording finishes fading.
      this._channels
        .get(playback.handle.channel)
        ?.shared.delete(playback.alias);
      return;
    }
    request.released = true;
    request.active = false;
    playback.requests.delete(request);
    if (playback.requests.size === 0 && !playback.playOnceOwned) {
      playback.handle.stop();
    }
  }

  private _finishSharedPlayback(
    channel: ChannelState,
    playback: SharedPlaybackState,
    endedNaturally: boolean,
  ): void {
    if (channel.shared.get(playback.alias) === playback) {
      channel.shared.delete(playback.alias);
    }

    const callbacks: Array<() => void> = [];
    if (endedNaturally && playback.playOnceOnEnd) {
      callbacks.push(playback.playOnceOnEnd);
    }
    playback.playOnceOwned = false;
    playback.playOnceOnEnd = undefined;
    for (const request of playback.requests) {
      request.active = false;
      if (endedNaturally && !request.released && request.onEnd) {
        callbacks.push(request.onEnd);
      }
    }
    playback.requests.clear();

    for (const callback of callbacks) {
      this._runCallback(callback, "Audio onEnd callback");
    }
  }
}

function validatePlay(options: AudioPlayOptions, duration: number): void {
  assertVolume("AudioManager.play.volume", options.volume ?? 1);
  assertSpeed("AudioManager.play.speed", options.speed ?? 1);
  assertPan("AudioManager.play.pan", options.pan ?? 0);
  assertTime("AudioManager.play.at", options.at ?? 0);
  const offset = options.offset ?? 0;
  assertTime("AudioManager.play.offset", offset);
  if (offset >= duration)
    throw new Error(
      `AudioManager.play: offset must be < ${duration}, got ${offset}.`,
    );
  if (options.stopAt !== undefined) {
    assertTime("AudioManager.play.stopAt", options.stopAt);
    if (options.stopAt < (options.at ?? 0))
      throw new Error("AudioManager.play: stopAt must be >= at.");
  }
  const start = options.loopStart ?? 0;
  const end = options.loopEnd ?? duration;
  assertTime("AudioManager.play.loopStart", start);
  assertPositive("AudioManager.play.loopEnd", end);
  if (start >= end || end > duration)
    throw new Error(
      "AudioManager.play: loop requires 0 <= loopStart < loopEnd <= buffer duration.",
    );
  if (
    !options.loop &&
    (options.loopStart !== undefined || options.loopEnd !== undefined)
  )
    throw new Error("AudioManager.play: loop points require loop: true.");
}
