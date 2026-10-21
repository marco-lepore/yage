export { VERSION } from "@yagejs/core";

// Plugin
export { AudioPlugin } from "./AudioPlugin.js";

// Manager
export { AudioManager } from "./AudioManager.js";
export { SoundHandle } from "./SoundHandle.js";

// Component
export { SoundComponent } from "./SoundComponent.js";

// Types
export { AudioManagerKey } from "./types.js";
export type {
  AudioConfig,
  AudioCrossfadeOptions,
  AudioFadeOptions,
  ChannelConfig,
  AudioPlayOptions,
  SoundComponentOptions,
  SoundRef,
  SoundRequestHandle,
  SoundRequestReleaseOptions,
} from "./types.js";

// Asset factories
export { sound, registerSound, unregisterSound } from "./assets.js";
export { renderAudio, measureAudio } from "./offline.js";
export type { OfflineAudioOptions, AudioMeasurements } from "./offline.js";
export type { AudioAutomationOptions, AudioDiagnostics } from "./types.js";

export type { SoundLoop } from "./assets.js";
export { soundBank, parseSoundBankManifest } from "./bank.js";
export type { SoundBank, SoundBankManifest, SoundBankEntry } from "./bank.js";

export { AudioTimeline } from "./internal/Automation.js";
export type { AudioAutomationPoint } from "./internal/Automation.js";
