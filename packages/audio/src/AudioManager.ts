import {
  globalRandom,
  type RandomService,
  type ErrorBoundary,
} from "@yagejs/core";
import { SoundHandle } from "./SoundHandle.js";
import { getSound, getSoundLoop } from "./assets.js";
import { AudioTimeline, automationTiming } from "./internal/Automation.js";
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
  volume: number;
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

export class AudioManager {
  private readonly _channels = new Map<string, ChannelState>();
  private readonly _random: RandomService;
  private readonly master: GainNode;
  private _masterVolume: number;
  private _autoMuteOnBlur: boolean;
  private _errorBoundary: ErrorBoundary | undefined;
  private readonly unlockListeners = new Set<() => void>();
  private readonly schedulers = new Set<
    (now: number, horizon: number) => void
  >();
  private nextId = 1;
  private disposed = false;
  private lateStarts = 0;
  private readonly failures: Array<{ operation: string; message: string }> = [];
  readonly lookahead: number;
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
    this._autoMuteOnBlur = config.autoMuteOnBlur ?? true;
    this.master = context.createGain();
    this.master.gain.value = this._masterVolume;
    this.master.connect(context.destination);
    for (const [name, definition] of Object.entries(definitions))
      this.createChannel(name, definition);
  }
  get currentTime(): number {
    return this.context.currentTime;
  }
  get sampleRate(): number {
    return this.context.sampleRate;
  }
  get masterVolume(): number {
    return this._masterVolume;
  }
  set masterVolume(volume: number) {
    assertVolume("AudioManager.masterVolume", volume);
    this._masterVolume = volume;
    this.master.gain.setValueAtTime(volume, this.currentTime);
  }
  get autoMuteOnBlur(): boolean {
    return this._autoMuteOnBlur;
  }
  set autoMuteOnBlur(value: boolean) {
    this._autoMuteOnBlur = value;
  }
  isUnlocked(): boolean {
    return this.context.state === "running";
  }
  hasSound(ref: SoundRef): boolean {
    return getSound(aliasOf(ref)) !== undefined;
  }

  play(ref: SoundRef, options: AudioPlayOptions = {}): SoundHandle {
    return this._startPlayback(ref, options, true).handle;
  }
  playRandom(aliases: SoundRef[], options?: AudioPlayOptions): SoundHandle {
    if (!aliases.length)
      throw new Error("AudioManager.playRandom: aliases must not be empty.");
    return this.play(this._random.pick(aliases), options);
  }
  crossfade(
    outgoing: SoundHandle,
    next: SoundRef,
    options: AudioCrossfadeOptions,
  ): SoundHandle {
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
  stop(handle: SoundHandle): void {
    handle.stop();
  }
  stopChannel(channel: string, at?: number): void {
    if (at !== undefined) assertTime("AudioManager.stopChannel.at", at);
    for (const state of this.descendants(channel))
      for (const handle of [...state.handles]) handle.stop(at);
  }
  stopAll(): void {
    for (const channel of this._channels.values())
      for (const handle of [...channel.handles]) handle.stop();
  }
  getChannelNames(): readonly string[] {
    return [...this._channels.keys()];
  }
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
      volume,
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
    state.volume = volume;
  }
  getChannelVolume(name: string): number {
    const state = this._channels.get(name);
    return state?.automation.valueAt(state.pauseAt ?? this.currentTime) ?? 1;
  }
  muteChannel(name: string): void {
    const state = this._ensureChannel(name);
    state.muted = true;
    state.mute.gain.setValueAtTime(0, this.currentTime);
  }
  unmuteChannel(name: string): void {
    const state = this._ensureChannel(name);
    state.muted = false;
    state.mute.gain.setValueAtTime(1, this.currentTime);
  }
  pauseChannel(name: string): void {
    this._ensureChannel(name).paused = true;
    this.reconcilePauses();
  }
  resumeChannel(name: string): void {
    this._ensureChannel(name).paused = false;
    this.reconcilePauses();
  }
  muteAll(): void {
    for (const name of this._channels.keys()) this.muteChannel(name);
  }
  unmuteAll(): void {
    for (const name of this._channels.keys()) this.unmuteChannel(name);
  }

  onUnlock(callback: () => void): () => void {
    if (this.isUnlocked()) this._runCallback(callback, "Audio unlock callback");
    else this.unlockListeners.add(callback);
    return () => this.unlockListeners.delete(callback);
  }
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
  /** @internal */
  _handleGesture(): void {
    if (!this.isUnlocked() || this.disposed) return;
    for (const callback of this.unlockListeners) {
      this.unlockListeners.delete(callback);
      this._runCallback(callback, "Audio unlock callback");
    }
  }
  /** @internal */
  _setErrorBoundary(boundary: ErrorBoundary | undefined): void {
    this._errorBoundary = boundary;
  }
  /** Attribute callbacks supplied by higher audio layers. */
  invoke<T>(operation: string, callback: () => T): T {
    let result!: T;
    this._runCallback(() => {
      return (result = callback());
    }, operation);
    return result;
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
  dispose(): void {
    if (this.disposed) return;
    this.stopAll();
    this.schedulers.clear();
    this.unlockListeners.clear();
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
    options = options.loop
      ? { ...getSoundLoop(alias), ...options }
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
