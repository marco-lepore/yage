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
  CorruptPayloadError,
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

export {
  memoryAdapter,
  localStorageAdapter,
  fileAdapter,
} from "./adapters/index.js";
export type {
  LocalStorageAdapterOptions,
  FileAdapterOptions,
  SaveFileStore,
} from "./adapters/index.js";
