// Plugin
export { TilemapPlugin } from "./TilemapPlugin.js";

// Component
export { TilemapComponent } from "./TilemapComponent.js";
export type {
  TilemapComponentOptions,
  TilemapComponentData,
} from "./TilemapComponent.js";

// System
export { TilemapRenderSystem } from "./TilemapRenderSystem.js";

// Asset handle factory
export { tiledMap } from "./assets.js";

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
  TilemapData,
  TileLayerData,
  ObjectLayerData,
  MapObject,
  MapObjectProperty,
  HasProperties,
  TilemapColliderConfig,
  RectColliderConfig,
  PolygonColliderConfig,
} from "./types.js";

// Tiled-specific (re-exported for backward compatibility)
export { tiledMapAssetExtension } from "./tiled/tiledMapLoader.js";
export {
  createTilemapLayers,
  extractObjects,
  toTilemapData,
} from "./tiled/parseTiledMap.js";
export type {
  TiledMapData,
  TileLayer,
  ObjectGroup,
  TileObject,
  RectangleObject,
  PolygonObject,
  PointObject,
  TileObjectProperty,
  TilesetRef,
  TilesetData,
  TileData,
} from "./tiled/types.js";
