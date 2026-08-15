export { DebugPlugin } from "./DebugPlugin.js";
export type {
  DebugConfig,
  DebugDiagnostics,
  LayerTransformSnapshot,
  CameraStackSnapshot,
} from "./DebugPlugin.js";
export type { IDebugClock } from "./DebugClock.js";
// Mirrored from the ./api subpath, which stays the import to reach for in game
// code — it carries the same surface without pulling in pixi.js.
export { DebugRegistryKey } from "./types.js";
export type {
  DebugGraphics,
  WorldDebugApi,
  HudDebugApi,
  StatsApi,
  DebugContributor,
  DebugRegistry,
  DebugVectorProvider,
  DebugVectorOptions,
} from "./types.js";
export { DebugRegistryImpl } from "./DebugRegistryImpl.js";
export { StatsStore } from "./StatsStore.js";
