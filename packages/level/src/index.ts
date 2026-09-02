export * from "./document.js";

export {
  defaultParams,
  describeParams,
  defineParams,
} from "./params/schema.js";
export { defineLevelAsset, param } from "./params/kinds.js";
export type { EntityRefOptions, LevelAssetDescriptor } from "./params/kinds.js";
export type {
  AssetFrames,
  ParamFieldDescription,
  ParamsOf,
  ParamsSchema,
} from "./params/types.js";

export { defineLevelEntity, defineLevelProject } from "./catalog/declare.js";
export { buildLevelCatalog } from "./catalog/build.js";
export type {
  CatalogError,
  CatalogResult,
  LevelCatalog,
  LevelCatalogEntry,
  LevelEntityClass,
  LevelEntityDeclaration,
  LevelProject,
  LevelProjectOptions,
  PackageContribution,
  ParamsMigration,
} from "./catalog/types.js";

export { loadLevelDocument } from "./load.js";
export { levelAssets, prepareLevel, validateLevel } from "./prepare/prepare.js";
export type {
  LevelDiagnostic,
  LevelDiagnosticCode,
  PlacementReference,
  PreparedLevel,
  PreparedPlacement,
} from "./prepare/types.js";

export { instantiateLevel } from "./runtime/instantiate.js";
export { LevelInstance } from "./runtime/LevelInstance.js";
export { LevelLoadError } from "./runtime/errors.js";
export type {
  InstantiateLevelOptions,
  LevelInstanceTransform,
} from "./runtime/types.js";
