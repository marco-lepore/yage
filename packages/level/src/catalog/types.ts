import type { Entity } from "@yagejs/core";
import type { JsonObject } from "../document/types.js";
import type { ParamFields, ParamsSchema } from "../params/types.js";

/** Rewrites one version of an entity's parameters into the next. */
export type ParamsMigration = (params: JsonObject) => JsonObject;

/**
 * What a class declares to become placeable in a level, built by
 * {@link defineLevelEntity} and held on the class as `static level`.
 */
export interface LevelEntityDeclaration<F extends ParamFields = ParamFields> {
  /** Stable type id a placement names, e.g. `"game.crate"`. */
  readonly id: string;
  /**
   * The parameter schema's current version. A placement records the version
   * its parameters were authored against, and preparation migrates the gap.
   */
  readonly version: number;
  /** Absent when the entity takes no setup parameters. */
  readonly params?: ParamsSchema<F>;
  /** Migration from version N to N + 1, keyed by N. */
  readonly migrations?: Readonly<Record<number, ParamsMigration>>;
}

/** An entity class that carries its own level declaration. */
export interface LevelEntityClass {
  new (): Entity;
  readonly level: LevelEntityDeclaration;
}

/**
 * Entities a package contributes to every project that depends on it. The
 * editor's build step discovers these from `yage.levelContribution` in a
 * direct dependency's manifest and imports them literally.
 */
export interface PackageContribution {
  /** The package that owns these entities, e.g. `"@yagejs/renderer"`. */
  readonly packageName: string;
  readonly entities: readonly LevelEntityClass[];
}

/** What {@link defineLevelProject} takes. */
export interface LevelProjectOptions {
  readonly entities: readonly LevelEntityClass[];
  readonly contributions?: readonly PackageContribution[];
}

/**
 * A project's placeable content, shared by the game and the editor. Plain
 * configuration: it is passed to the loader, never registered as a service.
 */
export interface LevelProject {
  readonly entities: readonly LevelEntityClass[];
  readonly contributions: readonly PackageContribution[];
}

/** One placeable entity type, and where it came from. */
export interface LevelCatalogEntry {
  readonly id: string;
  readonly declaration: LevelEntityDeclaration;
  readonly EntityClass: LevelEntityClass;
  readonly source: "project" | "package";
  /** The contributing package, when `source` is `"package"`. */
  readonly packageName?: string;
}

/**
 * Every placeable entity type a project has, keyed by type id. It carries the
 * contributions it was built from, so a consumer that needs both cannot pair
 * a catalog with a mismatched list.
 */
export interface LevelCatalog {
  readonly entries: readonly LevelCatalogEntry[];
  readonly contributions: readonly PackageContribution[];
  get(typeId: string): LevelCatalogEntry | undefined;
}

/** A problem with a project's declarations. */
export interface CatalogError {
  /** The entity type id, or `null` when the problem is with a class that has none. */
  readonly entityId: string | null;
  readonly message: string;
}

/**
 * What {@link buildLevelCatalog} returns. Catalog construction is
 * all-or-nothing: one bad declaration produces no partial catalog, and the
 * editor keeps showing the last one that built.
 */
export type CatalogResult =
  | { readonly ok: true; readonly catalog: LevelCatalog }
  | { readonly ok: false; readonly errors: readonly CatalogError[] };
