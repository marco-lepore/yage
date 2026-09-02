// Plugin
export { TilemapPlugin } from "./TilemapPlugin.js";

// Component
export { TilemapComponent } from "./TilemapComponent.js";
export type { TilemapComponentOptions } from "./TilemapComponent.js";

// Asset handle factory
export { tiledMap } from "./assets.js";

// Stable identity helpers
export { tiledObjectKey } from "./keys.js";

// Collision extraction
export { extractCollisionShapes } from "./colliders.js";
export { toPhysicsColliders } from "./toPhysicsColliders.js";

// Property utilities
export {
  getProperty,
  getPropertyArray,
  resolveObjectRef,
  resolveObjectRefArray,
} from "./properties.js";

// Generic types
export type {
  TilemapDiagnostic,
  TilemapDiagnosticCode,
  TilemapData,
  TileLayerData,
  ObjectLayerData,
  TilesetInfo,
  MapObject,
  MapObjectGroup,
  MapObjectProperty,
  HasProperties,
  TilemapColliderConfig,
  RectColliderConfig,
  CircleColliderConfig,
  CapsuleColliderConfig,
  PolygonColliderConfig,
  PolylineColliderConfig,
} from "./types.js";

// Tiled-specific (re-exported for backward compatibility)
export { tiledMapAssetExtension } from "./tiled/tiledMapLoader.js";
export { validateTiledMap } from "./tiled/diagnostics.js";
export { resolveTilesetData } from "./tiled/resolveTilesetData.js";
export { readTileGid, tileIdFromGid } from "./tiled/gid.js";
export type { TileGid } from "./tiled/gid.js";
export {
  createTilemapLayers,
  extractObjectGroups,
  extractObjects,
  toTilemapData,
} from "./tiled/parseTiledMap.js";
export type { TiledObjectGroup } from "./tiled/parseTiledMap.js";
export type {
  TiledMapData,
  TiledLayer,
  TileLayer,
  TileChunk,
  ObjectGroup,
  GroupLayer,
  ImageLayer,
  TileObject,
  RectangleObject,
  PolygonObject,
  PointObject,
  EllipseObject,
  CapsuleObject,
  TileObjectProperty,
  TilesetRef,
  TilesetData,
  TileData,
  TileAnimationFrame,
} from "./tiled/types.js";
