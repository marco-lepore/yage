export { VERSION } from "@yagejs/core";

// ---------------------------------------------------------------------------
// Save IO
// ---------------------------------------------------------------------------

export {
  Save,
  createSave,
  SlotNotFoundError,
  InvalidKeyError,
  StoreVersionTooNewError,
  StoreMigrationMissingError,
} from "./Save.js";
export type {
  SaveAdapter,
  SlotInfo,
  CreateSaveOptions,
  PersistOptions,
  RestoreOptions,
  SaveSlotOptions,
} from "./Save.js";

export { SavePlugin } from "./SavePlugin.js";
export type { SavePluginOptions } from "./SavePlugin.js";

export { SaveServiceKey } from "./keys.js";

export { memoryAdapter, localStorageAdapter } from "./adapters/index.js";
export type { LocalStorageAdapterOptions } from "./adapters/index.js";

// ---------------------------------------------------------------------------
// Snapshot system (full-scene quicksave via @serializable)
// ---------------------------------------------------------------------------

export type {
  SnapshotStorage,
  UntypedSlots,
  GameSnapshot,
  SceneSnapshotEntry,
  EntitySnapshotEntry,
  ComponentSnapshot,
  SnapshotContributor,
} from "./snapshot/types.js";
export type { SnapshotResolver } from "@yagejs/core";

export { LocalStorageSnapshotStorage } from "./snapshot/LocalStorageSnapshotStorage.js";

export { SnapshotService } from "./snapshot/SnapshotService.js";
export { SnapshotPlugin } from "./snapshot/SnapshotPlugin.js";
export type { SnapshotPluginOptions } from "./snapshot/SnapshotPlugin.js";
export { SnapshotServiceKey } from "./snapshot/keys.js";
