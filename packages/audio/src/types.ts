import { ServiceKey } from "@yagejs/core";
import type { AudioManager } from "./AudioManager.js";

export const AudioManagerKey = new ServiceKey<AudioManager>("audioManager");

export interface AudioConfig {
  channels?: Record<string, ChannelConfig>;
}

export interface ChannelConfig {
  volume?: number; // 0-1, default: 1
}

export interface AudioPlayOptions {
  channel?: string; // default: "sfx"
  volume?: number; // instance volume override, default: 1
  loop?: boolean; // default: false
  speed?: number; // playback rate, default: 1
}

export interface SoundComponentOptions {
  alias: string;
  channel?: string;
  playOnAdd?: boolean;
  loop?: boolean;
  volume?: number;
}

export interface SoundData {
  alias: string;
  channel: string;
  loop: boolean;
  volume: number;
  playOnAdd: boolean;
}
