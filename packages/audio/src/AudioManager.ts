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

  private _ensureChannel(name: string): ChannelState {
    let state = this._channels.get(name);
    if (!state) {
      state = { volume: 1, muted: false, paused: false, handles: new Map() };
      this._channels.set(name, state);
    }
    return state;
  }
}
