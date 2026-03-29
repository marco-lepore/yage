export { VERSION } from "@yage/core";

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
  ChannelConfig,
  AudioPlayOptions,
  SoundComponentOptions,
  SoundData,
} from "./types.js";

// Asset factories
export { sound } from "./assets.js";
