import { ServiceKey, type AssetHandle } from "@yagejs/core";
import type { Sound } from "@pixi/sound";
import type { AudioManager } from "./AudioManager.js";

export const AudioManagerKey = new ServiceKey<AudioManager>("audioManager");

/**
 * A sound to play: the alias it is registered under, or the handle `sound()`
 * returned for it — a handle's `path` is that alias.
 */
export type SoundRef = string | AssetHandle<Sound>;

export interface AudioConfig {
  channels?: Record<string, ChannelConfig>;
  /** Pause audio when the window loses focus or the tab is hidden. Default: `true`. */
  autoMuteOnBlur?: boolean;
}

export interface ChannelConfig {
  volume?: number; // 0-1, default: 1
}

export interface AudioPlayOptions {
  channel?: string; // default: "sfx"
  volume?: number; // instance volume override, default: 1
  loop?: boolean; // default: false
  speed?: number; // playback rate, default: 1
  /**
   * Called once when the sound finishes **on its own** (its `end` event). NOT
   * called when you `stop()` it, and never for a `loop`ing sound (it has no end).
   * The "tell me when this clip is done" seam — e.g. gating dialogue auto-advance
   * on a voice clip.
   */
  onEnd?: () => void;
}

/** One ownership request for playback shared by alias and channel. */
export interface SoundRequestHandle {
  /** True while this request still owns the shared playback. */
  readonly active: boolean;
  /** Release only this request. Idempotent. */
  release(): void;
}

export interface SoundComponentOptions {
  alias: string;
  channel?: string;
  playOnAdd?: boolean;
  loop?: boolean;
  volume?: number;
}
