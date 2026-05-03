export { VERSION } from "@yagejs/core";

// Types
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

// Storage
export { LocalStorageSnapshotStorage } from "./snapshot/LocalStorageSnapshotStorage.js";

// Service
export { SnapshotService } from "./snapshot/SnapshotService.js";
export { SnapshotPlugin } from "./snapshot/SnapshotPlugin.js";
export type { SnapshotPluginOptions } from "./snapshot/SnapshotPlugin.js";
export { SnapshotServiceKey } from "./snapshot/keys.js";
