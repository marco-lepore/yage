import type { AssetHandle } from "@yagejs/core";
import type { LevelCatalog, LevelCatalogEntry } from "../catalog/types.js";
import { isJsonValue, isPlainObject } from "../document/json.js";
import type {
  JsonObject,
  JsonValue,
  LevelDocument,
  LevelPlacement,
  StructuralError,
} from "../document/types.js";
import { describeError, describeValue } from "../internal/describe.js";
import {
  defineParams,
  paramAssets,
  referenceFields,
  validateParams,
} from "../params/schema.js";
import type { ParamFields, ParamsSchema } from "../params/types.js";
import type {
  LevelDiagnostic,
  LevelDiagnosticCode,
  PlacementReference,
  PreparedLevel,
  PreparedPlacement,
} from "./types.js";

/** Stands in for a declaration with no parameters, so one path serves both. */
const NO_PARAMS = defineParams({});

/**
 * Every problem with a document that only a catalog can find: an unknown type,
 * parameters that do not match a declaration, a version no migration reaches.
 *
 * This is {@link prepareLevel} asked for its diagnostics alone. The editor runs
 * it after every committed command; a game runs `prepareLevel` once and loads
 * the result.
 */
export function validateLevel(
  document: LevelDocument,
  catalog: LevelCatalog,
): readonly LevelDiagnostic[] {
  return prepareLevel(document, catalog).diagnostics;
}

/**
 * Check a document against a catalog, migrate its parameters to the versions
 * the declarations are at now, and derive the assets it needs.
 *
 * ```ts
 * const read = readLevel(rawLevel);
 * if (!read.ok) throw new Error("bad level file");
 * const forest = prepareLevel(read.document, catalog);
 * ```
 *
 * Preparation reports and never throws: the editor keeps working with a level
 * it cannot load, and lists what is wrong with it. `levelAssets()` and
 * `instantiateLevel()` both take the result, so a migration cannot make setup
 * depend on an asset that preloading never saw.
 *
 * The input is left untouched. Everything in the result is a copy, and frozen.
 */
export function prepareLevel(
  document: LevelDocument,
  catalog: LevelCatalog,
): PreparedLevel {
  // One copy up front: every placement below is already detached from the
  // caller's objects, so freezing the result cannot freeze data it still owns.
  const copy = structuredClone(document);
  const diagnostics: LevelDiagnostic[] = [];
  const placements: PreparedPlacement[] = [];
  const entities: LevelPlacement[] = [];

  // Built from the authored document, so a reference to a placement that
  // itself failed to prepare still resolves: a switch pointing at a crate with
  // a bad asset path is not itself broken.
  const typeById = new Map(copy.entities.map((one) => [one.id, one.type]));

  for (const placement of copy.entities) {
    const entry = catalog.get(placement.type);
    if (entry === undefined) {
      diagnostics.push(
        diagnostic(
          "unknown-type",
          placement.id,
          `Entity type "${placement.type}" is not in this project's catalog.`,
        ),
      );
      entities.push(placement);
      continue;
    }
    const prepared = preparePlacement(placement, entry, typeById, diagnostics);
    entities.push(prepared?.placement ?? placement);
    if (prepared) placements.push(prepared);
  }

  return Object.freeze({
    document: deepFreeze({ ...copy, entities }),
    placements: Object.freeze(placements),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * The asset handles a prepared level needs loaded, unique and in first-use
 * order. A scene's `preload` property takes them directly.
 *
 * Uniqueness is by loader type and path, which is how `AssetManager` counts
 * references. One authored path produces more than one handle object — the
 * derive and decode paths each build their own — and passing both would
 * retain the asset twice and release it once.
 */
export function levelAssets(
  prepared: PreparedLevel,
): readonly AssetHandle<unknown>[] {
  const unique = new Map<string, AssetHandle<unknown>>();
  for (const placement of prepared.placements) {
    for (const handle of placement.assets) {
      const key = `${handle.type}:${handle.path}`;
      if (!unique.has(key)) unique.set(key, handle);
    }
  }
  return Object.freeze([...unique.values()]);
}

/**
 * One diagnostic, frozen with its path. A `LevelLoadError` carries a refused
 * level's diagnostics through to the caller, so nothing downstream can rewrite
 * what preparation found.
 */
function diagnostic(
  code: LevelDiagnosticCode,
  placementId: string,
  message: string,
  path: readonly string[] = [],
): LevelDiagnostic {
  return Object.freeze({
    code,
    placementId,
    path: Object.freeze([...path]),
    message,
  });
}

function preparePlacement(
  placement: LevelPlacement,
  entry: LevelCatalogEntry,
  typeById: ReadonlyMap<string, string>,
  diagnostics: LevelDiagnostic[],
): PreparedPlacement | undefined {
  const { declaration } = entry;
  const report = (
    code: LevelDiagnosticCode,
    message: string,
    path: readonly string[] = [],
  ): undefined => {
    diagnostics.push(diagnostic(code, placement.id, message, path));
    return undefined;
  };

  const migrated = migrateParams(
    placement,
    declaration.version,
    entry,
    (message) => report("migration-failed", message),
  );
  if (!migrated) return undefined;

  const schema = declaration.params ?? NO_PARAMS;
  const errors = validateParams(schema, migrated);
  if (errors.length > 0) {
    for (const error of errors) {
      report(
        "parameter-invalid",
        `Parameter "${error.path.join(".")}" ${error.message}.`,
        error.path,
      );
    }
    return undefined;
  }

  const references = prepareReferences(schema, migrated, typeById, report);
  if (references === undefined) return undefined;

  let assets: readonly AssetHandle<unknown>[];
  try {
    assets = paramAssets(schema, migrated);
  } catch (error) {
    return report(
      "asset-derivation-failed",
      `Deriving assets failed: ${describeError(error)}`,
    );
  }

  return Object.freeze({
    placement: {
      ...placement,
      typeVersion: declaration.version,
      params: migrated,
    },
    entry,
    assets: Object.freeze([...assets]),
    references: Object.freeze(references),
  });
}

/**
 * Check every reference parameter against the document, and collect what the
 * placement points at. `undefined` when any of them is a problem, so the
 * placement is reported and left out of the loadable set.
 *
 * The three codes are separate from `parameter-invalid` because the repairs
 * differ: resetting a parameter to its default writes "nothing chosen" back,
 * which fixes none of them.
 */
function prepareReferences(
  schema: ParamsSchema<ParamFields>,
  params: JsonObject,
  typeById: ReadonlyMap<string, string>,
  report: (
    code: LevelDiagnosticCode,
    message: string,
    path: readonly string[],
  ) => undefined,
): PlacementReference[] | undefined {
  const references: PlacementReference[] = [];
  let failed = false;
  for (const field of referenceFields(schema)) {
    const value = Reflect.get(params, field.name) as JsonValue;
    const accepted = field.types.join(", ");
    if (value === null) {
      if (field.optional) continue;
      report(
        "reference-unset",
        `Parameter "${field.name}" needs a ${accepted} and has none chosen.`,
        [field.name],
      );
      failed = true;
      continue;
    }
    const targetId = value as string;
    const targetType = typeById.get(targetId);
    if (targetType === undefined) {
      report(
        "reference-missing",
        `Parameter "${field.name}" points at placement "${targetId}", which is not in this level.`,
        [field.name],
      );
      failed = true;
      continue;
    }
    if (!field.types.includes(targetType)) {
      report(
        "reference-type",
        `Parameter "${field.name}" accepts ${accepted} and points at placement "${targetId}", which is a ${targetType}.`,
        [field.name],
      );
      failed = true;
      continue;
    }
    // A self-reference is not excluded: it is a one-placement cycle, and the
    // loader reserves every placement before any setup runs.
    references.push(
      Object.freeze({ path: Object.freeze([field.name]), targetId }),
    );
  }
  return failed ? undefined : references;
}

/**
 * Run the declared migrations from the version a placement was authored
 * against up to the version the declaration is at now. Each one gets its own
 * copy of the parameters, so a migration that throws part-way leaves nothing
 * half-rewritten, and the placement keeps what was authored.
 */
function migrateParams(
  placement: LevelPlacement,
  current: number,
  entry: LevelCatalogEntry,
  report: (message: string) => undefined,
): JsonObject | undefined {
  if (placement.typeVersion > current) {
    return report(
      `Parameters were authored against type version ${placement.typeVersion}, ` +
        `and "${entry.id}" declares version ${current}. This level is newer than the game.`,
    );
  }

  let params = placement.params;
  for (let version = placement.typeVersion; version < current; version++) {
    const migration = entry.declaration.migrations?.[version];
    if (!migration) {
      return report(
        `"${entry.id}" declares no migration from type version ${version} to ${version + 1}.`,
      );
    }
    let returned: unknown;
    try {
      returned = migration(structuredClone(params));
    } catch (error) {
      return report(
        `The migration from type version ${version} failed: ${describeError(error)}`,
      );
    }
    const problem = jsonObjectProblem(returned);
    if (problem) {
      return report(
        `The migration from type version ${version} returned ${problem}.`,
      );
    }
    params = returned as JsonObject;
  }
  return params;
}

/**
 * Why a migration's return cannot be a placement's parameters, or `undefined`
 * when it can. A `Map` or a `Date` passes a `typeof` check and would be stored
 * as something else entirely, so the shape is checked the same way the parser
 * checks a document handed to it as data.
 */
function jsonObjectProblem(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return `${describeValue(value)}, not a parameter object`;
  }
  const problems: StructuralError[] = [];
  if (isJsonValue(value, 0, "params", problems)) return undefined;
  const first = problems[0];
  return first === undefined
    ? "a value that is not JSON"
    : `${first.path}, which ${first.message}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
