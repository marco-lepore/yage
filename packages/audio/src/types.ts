import { ServiceKey, type AssetHandle } from "@yagejs/core";
import type { AudioManager } from "./AudioManager.js";
/** Resolves the engine's `AudioManager`. */
export const AudioManagerKey = new ServiceKey<AudioManager>("audioManager");
/** A sound alias, or the handle `sound()` returned for it. */
export type SoundRef = string | AssetHandle<AudioBuffer>;

/** `AudioPlugin` configuration. */
export interface AudioConfig {
  /** Initial master volume, 0–1. Default 1. */
  masterVolume?: number;
  /** Extra channels. The `sfx` (1) and `music` (0.7) defaults remain. */
  channels?: Record<string, ChannelConfig>;
  /**
   * Pause all audio while the host is inactive (`Host.active` is `false`): the
   * app is in the background, the page is hidden, or the window is unfocused.
   * Default: `true`.
   */
  autoPause?: boolean;
  /** Scheduler horizon in audio seconds. Default 0.12. */
  lookahead?: number;
  /** Timer interval in seconds. Default 0.025; must be shorter than lookahead. */
  tickInterval?: number;
}
/** Options for a configured or created channel. */
export interface ChannelConfig {
  /** Channel volume, 0–1. Default 1. */
  volume?: number;
  /** Existing channel through which this channel is mixed. */
  parent?: string;
}
/** When and how a volume, speed or pan change happens. */
export interface AudioAutomationOptions {
  /** Absolute AudioManager.currentTime seconds. Defaults to now. */
  at?: number;
  /** Ramp length in audio seconds. Default 0 (a step). */
  duration?: number;
  /** Ramp shape. Default linear; exponential needs positive values. */
  curve?: "linear" | "exponential";
}
/** Options for `AudioManager.play` and its variants. */
export interface AudioPlayOptions {
  /** Channel to play through. Default `sfx`; an unknown name creates it. */
  channel?: string;
  /** Per-sound volume, 0–1. Default 1. */
  volume?: number;
  /** Playback rate. Default 1. */
  speed?: number;
  /** Stereo position, -1 to 1. Default 0. */
  pan?: number;
  /** Repeat the loop region, or the whole sound. Default false. */
  loop?: boolean;
  /** Loop region in source seconds. Requires loop: true. */
  loopStart?: number;
  /** Loop region end in source seconds. Default: the sound's sustain loop, else its duration. */
  loopEnd?: number;
  /** Absolute audio-clock start. Omit for immediate playback. */
  at?: number;
  /** Position in the recording, in source seconds. Default 0. */
  offset?: number;
  /** Absolute audio-clock stop. */
  stopAt?: number;
  /** Fires only for natural buffer completion, never for explicit stop. */
  onEnd?: () => void;
}
/** Options for `SoundHandle.fadeTo`. */
export interface AudioFadeOptions extends AudioAutomationOptions {
  /** Fade length in seconds, greater than 0. */
  duration: number;
  /** Stop the sound when a fade to 0 completes. Default false. */
  stopOnComplete?: boolean;
}
/** Play options for the incoming sound of `AudioManager.crossfade`. */
export interface AudioCrossfadeOptions extends AudioPlayOptions {
  /** Length of both linear fades in seconds, greater than 0. */
  duration: number;
}
/** Options for `SoundHandle.release`. */
export interface SoundReleaseOptions {
  /** Absolute audio-clock time the fade starts. Default: now. */
  at?: number;
  /** Fade length in seconds. Default 0.05; 0 stops without a fade. */
  duration?: number;
}
/** Options for `SoundRequestHandle.release`. */
export interface SoundRequestReleaseOptions {
  /** Seconds to fade out when the final owner releases. Default 0 (stop now). */
  fadeOut?: number;
}
/** One owner of a sound shared through `AudioManager.requestOnce`. */
export interface SoundRequestHandle {
  /** False once released (after any fade) or once the sound has ended. */
  readonly active: boolean;
  /** Give up this request; the sound stops when no owner remains. */
  release(options?: SoundRequestReleaseOptions): void;
}
/** Options for `SoundComponent`. */
export interface SoundComponentOptions {
  alias: string;
  channel?: string;
  playOnAdd?: boolean;
  loop?: boolean;
  volume?: number;
}
/** Snapshot returned by `AudioManager.getDiagnostics`. */
export interface AudioDiagnostics {
  readonly state: AudioContextState;
  readonly currentTime: number;
  /** Sounds playing, paused or booked. */
  readonly activeVoices: number;
  /** Sounds whose booked start is still in the future. */
  readonly scheduledVoices: number;
  /** Callbacks registered with `addScheduler`. */
  readonly schedulerCount: number;
  /** Plays booked for a time that had already passed; they started late. */
  readonly lateStarts: number;
  readonly channels: readonly {
    name: string;
    volume: number;
    muted: boolean;
    paused: boolean;
    voices: number;
  }[];
  /** The most recent callback and context failures, up to 50. */
  readonly failures: readonly { operation: string; message: string }[];
}
