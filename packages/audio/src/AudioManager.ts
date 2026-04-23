import type { SoundLibrary } from "@pixi/sound";
import { SoundHandle } from "./SoundHandle.js";
import type { AudioConfig, AudioPlayOptions } from "./types.js";

interface ChannelState {
  volume: number;
  muted: boolean;
  paused: boolean;
  handles: Map<SoundHandle, { instanceVolume: number }>;
}

const DEFAULT_CHANNELS: Record<string, { volume: number }> = {
  sfx: { volume: 1 },
  music: { volume: 0.7 },
};

export class AudioManager {
  private readonly _sound: SoundLibrary;
  private readonly _channels = new Map<string, ChannelState>();
  private readonly _handleAliases = new WeakMap<SoundHandle, string>();

  private _autoMuteOnBlur: boolean;
  private readonly _unlockListeners: Array<() => void> = [];
  private _blurMutedSnapshot: boolean | null = null;
  private _isBlurred = false;

  constructor(sound: SoundLibrary, config?: AudioConfig) {
    this._sound = sound;

    const channelDefs = config?.channels ?? DEFAULT_CHANNELS;
    for (const [name, cfg] of Object.entries(channelDefs)) {
      this._channels.set(name, {
        volume: cfg.volume ?? 1,
        muted: false,
        paused: false,
        handles: new Map(),
      });
    }

    this._autoMuteOnBlur = config?.autoMuteOnBlur ?? true;
  }

  play(alias: string, options?: AudioPlayOptions): SoundHandle {
    const channelName = options?.channel ?? "sfx";
    const channel = this._ensureChannel(channelName);
    const instanceVolume = options?.volume ?? 1;
    const effectiveVolume = channel.volume * instanceVolume;

    const result = this._sound.play(alias, {
      volume: effectiveVolume,
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

    const cleanup = (): void => { channel.handles.delete(handle); };
    result.once("end", cleanup);
    result.once("stop", cleanup);

    // Apply channel mute/pause state to new handle
    if (channel.muted) {
      handle.muted = true;
    }
    if (channel.paused) {
      handle.paused = true;
    }

    return handle;
  }

  /**
   * Play a sound only if it isn't already playing (via a prior `playOnce` call).
   * Returns the existing handle if still playing, or a new one otherwise.
   * Note: only deduplicates against handles created by `playOnce`, not `play`.
   */
  playOnce(alias: string, options?: AudioPlayOptions): SoundHandle {
    const channelName = options?.channel ?? "sfx";
    const channel = this._ensureChannel(channelName);

    // Check if any existing handle for this alias is still playing
    for (const handle of channel.handles.keys()) {
      if (handle.playing) {
        // We can't check alias on SoundHandle, so we track it with a WeakMap
        const trackedAlias = this._handleAliases.get(handle);
        if (trackedAlias === alias) {
          return handle;
        }
      }
    }

    const handle = this.play(alias, options);
    this._handleAliases.set(handle, alias);
    return handle;
  }

  playRandom(aliases: string[], options?: AudioPlayOptions): SoundHandle {
    if (aliases.length === 0) {
      throw new Error("playRandom: aliases array must not be empty.");
    }
    const alias = aliases[Math.floor(Math.random() * aliases.length)]!;
    return this.play(alias, options);
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
      cb();
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

  /** Mute audio when the tab is hidden (default: `true`). */
  get autoMuteOnBlur(): boolean {
    return this._autoMuteOnBlur;
  }

  set autoMuteOnBlur(value: boolean) {
    if (this._autoMuteOnBlur === value) return;
    this._autoMuteOnBlur = value;
    // If disabling mid-blur, restore audio immediately.
    if (!value && this._isBlurred && this._blurMutedSnapshot !== null) {
      this._restoreBlurMute();
    }
  }

  /**
   * Called by `AudioPlugin` on `visibilitychange` events. Parameterised on
   * `hidden` so unit tests can drive it without a real `document`.
   * @internal
   */
  _handleVisibilityChange(hidden: boolean): void {
    if (hidden && !this._isBlurred) {
      this._isBlurred = true;
      if (this._autoMuteOnBlur) this._applyBlurMute();
    } else if (!hidden && this._isBlurred) {
      this._isBlurred = false;
      if (this._blurMutedSnapshot !== null) this._restoreBlurMute();
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
      try {
        cb();
      } catch {
        // Swallow: a throwing listener must not poison the rest of the queue.
      }
    }
  }

  private _applyBlurMute(): void {
    const ctx = this._getMediaContext();
    if (!ctx) return;
    this._blurMutedSnapshot = ctx.muted;
    ctx.muted = true;
  }

  private _restoreBlurMute(): void {
    const ctx = this._getMediaContext();
    if (ctx && this._blurMutedSnapshot !== null) {
      ctx.muted = this._blurMutedSnapshot;
    }
    this._blurMutedSnapshot = null;
  }

  private _getMediaContext(): { muted: boolean } | undefined {
    const ctx = (this._sound as unknown as { context?: { muted: boolean } })
      .context;
    return ctx;
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
      state = { volume: 1, muted: false, paused: false, handles: new Map() };
      this._channels.set(name, state);
    }
    return state;
  }
}
