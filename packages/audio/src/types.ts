import { ServiceKey, type AssetHandle } from "@yagejs/core";
import type { AudioManager } from "./AudioManager.js";
export const AudioManagerKey = new ServiceKey<AudioManager>("audioManager");
export type SoundRef = string | AssetHandle<AudioBuffer>;

export interface AudioConfig {
  masterVolume?: number;
  channels?: Record<string, ChannelConfig>;
  /** Suspend the context on blur/hidden and resume it on focus. Default true. */
  autoMuteOnBlur?: boolean;
  /** Scheduler horizon in audio seconds. Default 0.12. */
  lookahead?: number;
  /** Timer interval in seconds. Default 0.025; must be shorter than lookahead. */
  tickInterval?: number;
}
export interface ChannelConfig {
  volume?: number;
  /** Existing channel through which this channel is mixed. */
  parent?: string;
}
export interface AudioAutomationOptions {
  /** Absolute AudioManager.currentTime seconds. Defaults to now. */
  at?: number;
  /** Ramp length in audio seconds. Default 0 (a step). */
  duration?: number;
  curve?: "linear" | "exponential";
}
export interface AudioPlayOptions {
  channel?: string;
  volume?: number;
  speed?: number;
  pan?: number;
  loop?: boolean;
  /** Loop region in source seconds. Requires loop: true. */
  loopStart?: number;
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
export interface AudioFadeOptions extends AudioAutomationOptions {
  duration: number;
  stopOnComplete?: boolean;
}
export interface AudioCrossfadeOptions extends AudioPlayOptions {
  duration: number;
}
export interface SoundRequestReleaseOptions {
  fadeOut?: number;
}
export interface SoundRequestHandle {
  readonly active: boolean;
  release(options?: SoundRequestReleaseOptions): void;
}
export interface SoundComponentOptions {
  alias: string;
  channel?: string;
  playOnAdd?: boolean;
  loop?: boolean;
  volume?: number;
}
export interface AudioDiagnostics {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly activeVoices: number;
  readonly scheduledVoices: number;
  readonly schedulerCount: number;
  readonly lateStarts: number;
  readonly channels: readonly {
    name: string;
    volume: number;
    muted: boolean;
    paused: boolean;
    voices: number;
  }[];
  readonly failures: readonly { operation: string; message: string }[];
}
