import type { IMediaInstance, SoundLibrary } from "@pixi/sound";
import {
  globalRandom,
  type RandomService,
  type ErrorBoundary,
} from "@yagejs/core";
import { SoundHandle } from "./SoundHandle.js";
import type {
  AudioConfig,
  AudioPlayOptions,
  SoundRef,
  SoundRequestHandle,
} from "./types.js";

interface SoundRequestState {
  active: boolean;
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
  handles: Map<SoundHandle, { instanceVolume: number }>;
  shared: Map<string, SharedPlaybackState>;
}

interface StartedPlayback {
  readonly alias: string;
  readonly channel: ChannelState;
  readonly handle: SoundHandle;
  readonly instance: IMediaInstance;
}

const DEFAULT_CHANNELS: Record<string, { volume: number }> = {
  sfx: { volume: 1 },
  music: { volume: 0.7 },
};

/** A `sound()` handle's `path` is the alias the asset is registered under. */
function aliasOf(ref: SoundRef): string {
  return typeof ref === "string" ? ref : ref.path;
}

export class AudioManager {
  private readonly _sound: SoundLibrary;
  private readonly _random: RandomService;
  private readonly _channels = new Map<string, ChannelState>();

  private _autoMuteOnBlur: boolean;
  private readonly _unlockListeners: Array<() => void> = [];
  /**
   * Wired by {@link _setErrorBoundary} during `AudioPlugin.install`, since
   * this manager is constructed directly (no `EngineContext` of its own)
   * rather than resolved through DI.
   */
  private _errorBoundary: ErrorBoundary | undefined;

  constructor(
    sound: SoundLibrary,
    config?: AudioConfig,
    random?: RandomService,
  ) {
    this._sound = sound;
    this._random = random ?? globalRandom;

    const channelDefs = config?.channels ?? DEFAULT_CHANNELS;
    for (const [name, cfg] of Object.entries(channelDefs)) {
      this._channels.set(name, {
        volume: cfg.volume ?? 1,
        muted: false,
        paused: false,
        handles: new Map(),
        shared: new Map(),
      });
    }

    this._autoMuteOnBlur = config?.autoMuteOnBlur ?? true;

    // Delegate pause-on-blur to pixi-sound's built-in autoPause. It listens to
    // `window.blur`/`focus` itself and suspends/resumes the AudioContext —
    // saves us from owning a parallel visibility listener.
    const ctx = this._getBlurContext();
    if (ctx) ctx.autoPause = this._autoMuteOnBlur;
  }

  /**
   * Play a preloaded or registered sound. Accepts the alias or the handle
   * `sound()` returned. Throws when the alias resolves to nothing — that is
   * a typo, or playback before the asset was preloaded.
   */
  play(ref: SoundRef, options?: AudioPlayOptions): SoundHandle {
    return this._startPlayback(ref, options, true).handle;
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
      onEnd: options?.onEnd,
    };
    playback.requests.add(request);
    return {
      get active(): boolean {
        return request.active;
      },
      release: () => this._releaseRequest(playback, request),
    };
  }

  playRandom(aliases: SoundRef[], options?: AudioPlayOptions): SoundHandle {
    if (aliases.length === 0) {
      throw new Error("playRandom: aliases array must not be empty.");
    }
    return this.play(this._random.pick(aliases), options);
  }

  stop(handle: SoundHandle): void {
    handle.stop();
  }

  stopChannel(channel: string): void {
    const state = this._channels.get(channel);
    if (!state) return;
    for (const handle of [...state.handles.keys()]) {
      handle.stop();
    }
  }

  stopAll(): void {
    for (const channel of this._channels.keys()) {
      this.stopChannel(channel);
    }
  }

  setChannelVolume(channel: string, volume: number): void {
    const state = this._ensureChannel(channel);
    state.volume = volume;
    for (const [handle, meta] of state.handles) {
      handle.volume = volume * meta.instanceVolume;
    }
  }

  getChannelVolume(channel: string): number {
    return this._ensureChannel(channel).volume;
  }

  muteChannel(channel: string): void {
    const state = this._ensureChannel(channel);
    state.muted = true;
    for (const handle of state.handles.keys()) {
      handle.muted = true;
    }
  }

  unmuteChannel(channel: string): void {
    const state = this._ensureChannel(channel);
    state.muted = false;
    for (const handle of state.handles.keys()) {
      handle.muted = false;
    }
  }

  pauseChannel(channel: string): void {
    const state = this._ensureChannel(channel);
    state.paused = true;
    for (const handle of state.handles.keys()) {
      handle.paused = true;
    }
  }

  resumeChannel(channel: string): void {
    const state = this._ensureChannel(channel);
    state.paused = false;
    for (const handle of state.handles.keys()) {
      handle.paused = false;
    }
  }

  muteAll(): void {
    for (const channel of this._channels.keys()) {
      this.muteChannel(channel);
    }
  }

  unmuteAll(): void {
    for (const channel of this._channels.keys()) {
      this.unmuteChannel(channel);
    }
  }

  /**
   * Whether the underlying `AudioContext` is running (i.e. audio will play).
   * Browsers suspend the context on page load until a user gesture; this is
   * purely a browser-level capability check and is not affected by
   * `autoMuteOnBlur`.
   */
  isUnlocked(): boolean {
    const ctx = this._getAudioContext();
    return ctx?.state === "running";
  }

  /**
   * Fires `cb` once when audio becomes playable. If already unlocked, fires
   * synchronously. Returns a disposer that removes the pending listener (no-op
   * once it has fired).
   */
  onUnlock(cb: () => void): () => void {
    if (this.isUnlocked()) {
      // Match the queued path's behavior: a throwing listener must not
      // propagate back to the registration site. Otherwise the same
      // callback behaves differently depending on whether it was queued
      // or fired synchronously.
      this._runUnlockCallback(cb);
      return () => {};
    }
    this._unlockListeners.push(cb);
    return () => this.offUnlock(cb);
  }

  /** Remove a listener registered with `onUnlock`. */
  offUnlock(cb: () => void): void {
    const idx = this._unlockListeners.indexOf(cb);
    if (idx !== -1) this._unlockListeners.splice(idx, 1);
  }

  /** Pause audio when the window loses focus or the tab is hidden. Default: `true`. */
  get autoMuteOnBlur(): boolean {
    return this._autoMuteOnBlur;
  }

  set autoMuteOnBlur(value: boolean) {
    if (this._autoMuteOnBlur === value) return;
    this._autoMuteOnBlur = value;
    const ctx = this._getBlurContext();
    if (!ctx) return;
    ctx.autoPause = value;
    // Pixi only acts on the next blur event. If the toggle happens while the
    // window is already blurred, sync `paused` so the change takes effect now.
    if (typeof document !== "undefined" && !document.hasFocus()) {
      ctx.paused = value;
    }
  }

  /**
   * Called by `AudioPlugin` after a user gesture fires. Fires pending
   * `onUnlock` listeners if the context has become running.
   * @internal
   */
  _handleGesture(): void {
    if (!this.isUnlocked()) return;
    const pending = this._unlockListeners.splice(0);
    for (const cb of pending) {
      this._runUnlockCallback(cb);
    }
  }

  /**
   * Wire the error boundary so a throwing developer callback is attributed
   * instead of escaping into `@pixi/sound`. Called by `AudioPlugin.install`.
   * @internal
   */
  _setErrorBoundary(boundary: ErrorBoundary | undefined): void {
    this._errorBoundary = boundary;
  }

  /**
   * Run one developer callback: a throw is recorded against `kind` and
   * rethrown, and with no boundary registered the callback runs raw. The
   * `onEnd` site uses this directly; `onUnlock` wraps it to keep its own
   * no-boundary swallow.
   */
  private _runCallback(cb: () => void, kind: string): void {
    if (this._errorBoundary) {
      this._errorBoundary.wrapCallback(cb, { kind });
    } else {
      cb();
    }
  }

  /** Run one `onUnlock` listener. */
  private _runUnlockCallback(cb: () => void): void {
    if (this._errorBoundary) {
      this._runCallback(cb, "Audio unlock callback");
      return;
    }
    // An unlock listener fires synchronously from `onUnlock` when the context
    // is already running, so an unattributed throw would surface at the
    // registration site rather than where the queued path delivers it.
    try {
      cb();
    } catch {
      // No boundary registered — nothing to report it to.
    }
  }

  private _getBlurContext():
    | { autoPause: boolean; paused: boolean }
    | undefined {
    // `autoPause` only exists on pixi-sound's WebAudioContext. The HTMLAudio
    // fallback (no WebAudio support, or `useLegacy=true`) lacks it — return
    // undefined there so callers no-op rather than silently writing a dead
    // property. `paused` is on IMediaContext, but we guard it together since
    // reconciliation only makes sense when autoPause is also writable.
    const ctx = (this._sound as unknown as { context?: unknown }).context;
    if (
      ctx !== null &&
      typeof ctx === "object" &&
      "autoPause" in ctx &&
      "paused" in ctx
    ) {
      return ctx as { autoPause: boolean; paused: boolean };
    }
    return undefined;
  }

  private _getAudioContext(): { state: string } | undefined {
    const ctx = (
      this._sound as unknown as {
        context?: { audioContext?: { state: string } };
      }
    ).context;
    return ctx?.audioContext;
  }

  private _ensureChannel(name: string): ChannelState {
    let state = this._channels.get(name);
    if (!state) {
      state = {
        volume: 1,
        muted: false,
        paused: false,
        handles: new Map(),
        shared: new Map(),
      };
      this._channels.set(name, state);
    }
    return state;
  }

  private _startPlayback(
    ref: SoundRef,
    options: AudioPlayOptions | undefined,
    attachOnEnd: boolean,
  ): StartedPlayback {
    const alias = aliasOf(ref);
    if (!this._sound.exists(alias)) {
      throw new Error(
        `AudioManager.play: no sound registered as "${alias}". Preload it ` +
          `with sound(...) or register it with registerSound().`,
      );
    }

    const channel = this._ensureChannel(options?.channel ?? "sfx");
    const instanceVolume = options?.volume ?? 1;
    const result = this._sound.play(alias, {
      volume: channel.volume * instanceVolume,
      loop: options?.loop ?? false,
      speed: options?.speed ?? 1,
    });
    if (result instanceof Promise) {
      throw new Error(
        `Sound "${alias}" is not preloaded. Call sound.add() before playing.`,
      );
    }

    const handle = new SoundHandle(result);
    channel.handles.set(handle, { instanceVolume });
    const cleanup = (): void => {
      channel.handles.delete(handle);
    };
    result.once("end", cleanup);
    result.once("stop", cleanup);

    const onEnd = options?.onEnd;
    if (attachOnEnd && onEnd) {
      result.once("end", () =>
        this._runCallback(onEnd, "Audio onEnd callback"),
      );
    }

    if (channel.muted) handle.muted = true;
    if (channel.paused) handle.paused = true;
    return { alias, channel, handle, instance: result };
  }

  private _startSharedPlayback(
    ref: SoundRef,
    options: AudioPlayOptions | undefined,
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
    started.instance.once("end", () =>
      this._finishSharedPlayback(started.channel, playback, true),
    );
    started.instance.once("stop", () =>
      this._finishSharedPlayback(started.channel, playback, false),
    );
    return playback;
  }

  private _releaseRequest(
    playback: SharedPlaybackState,
    request: SoundRequestState,
  ): void {
    if (!request.active) return;
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
      if (endedNaturally && request.onEnd) callbacks.push(request.onEnd);
    }
    playback.requests.clear();

    for (const callback of callbacks) {
      this._runCallback(callback, "Audio onEnd callback");
    }
  }
}
