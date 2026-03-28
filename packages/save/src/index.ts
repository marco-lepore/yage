export { VERSION } from "@yage/core";

// Types
export type {
  SaveStorage,
  UntypedSlots,
  SnapshotResolver,
  GameSnapshot,
  SceneSnapshotEntry,
  EntitySnapshotEntry,
  ComponentSnapshot,
} from "./types.js";

// Storage
export { LocalStorageSaveStorage } from "./LocalStorageAdapter.js";

// Service
export { SaveService } from "./SaveService.js";
export { SavePlugin } from "./SavePlugin.js";
export type { SavePluginOptions } from "./SavePlugin.js";
export { SaveServiceKey } from "./keys.js";
