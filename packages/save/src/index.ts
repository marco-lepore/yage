export { VERSION } from "@yagejs/core";

// Types
export type {
  SaveStorage,
  UntypedSlots,
  GameSnapshot,
  SceneSnapshotEntry,
  EntitySnapshotEntry,
  ComponentSnapshot,
} from "./types.js";
export type { SnapshotResolver } from "@yagejs/core";

// Storage
export { LocalStorageSaveStorage } from "./LocalStorageAdapter.js";

// Service
export { SaveService } from "./SaveService.js";
export { SavePlugin } from "./SavePlugin.js";
export type { SavePluginOptions } from "./SavePlugin.js";
export { SaveServiceKey } from "./keys.js";
