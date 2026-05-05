export { VERSION } from "@yagejs/core";

// ---------------------------------------------------------------------------
// Stores + save IO (primary persistence path — typed reactive stores)
// ---------------------------------------------------------------------------

// Re-exported store primitives so users can `import { defineStore } from "@yagejs/save"`
// when they prefer to read it as a save concern. Originals live in @yagejs/core.
export {
  defineStore,
  defineSet,
  defineMap,
  defineCounter,
  jsonCodec,
  setCodec,
  mapCodec,
  dateCodec,
  StoreVersionTooNewError,
  StoreMigrationMissingError,
} from "@yagejs/core";
export type {
  PersistentLike,
  PersistentStore,
  PersistentSet,
  PersistentMap,
  PersistentCounter,
  DefineStoreOptions,
  DefineSetOptions,
  DefineMapOptions,
  DefineCounterOptions,
  Codec,
} from "@yagejs/core";

export {
  Save,
  createSave,
  SlotNotFoundError,
  InvalidKeyError,
} from "./Save.js";
export type { SaveAdapter, SlotInfo, CreateSaveOptions } from "./Save.js";

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
