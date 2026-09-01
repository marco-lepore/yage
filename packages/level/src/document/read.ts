import { isJsonValue, isPlainObject } from "./json.js";
import type {
  JsonObject,
  LevelPlacement,
  LevelPoint,
  LevelTransform,
  StructuralError,
  StructuralResult,
} from "./types.js";

/** Document fields, in the order the canonical form writes them. */
const DOCUMENT_FIELDS = [
  "$schema",
  "format",
  "version",
  "id",
  "metadata",
  "entities",
  "extensions",
] as const;

const PLACEMENT_FIELDS = [
  "id",
  "type",
  "typeVersion",
  "name",
  "key",
  "parent",
  "active",
  "transform",
  "params",
  "extensions",
] as const;

/**
 * Parse a level document, strictly.
 *
 * `source` is either the file's text or JSON data that has already been
 * through `JSON.parse` — an imported `*.yage-level.json`, or a fetched body.
 * Every structural problem in it is collected and returned rather than thrown,
 * because the caller is usually an editor that must keep working with the
 * document it already has.
 *
 * Structural means what the document can be checked for on its own: field
 * shapes, finite numbers, unique ids, and a parent hierarchy that is a tree.
 * Whether `type` names an entity that exists is a question for a catalog, and
 * belongs to preparation.
 */
export function readLevel(source: unknown): StructuralResult {
  const errors: StructuralError[] = [];
  const value = typeof source === "string" ? parseText(source, errors) : source;
  if (errors.length > 0) return { ok: false, errors };

  const root = requireObject(value, "", errors);
  if (!root) return { ok: false, errors };

  rejectUnknownFields(root, DOCUMENT_FIELDS, "", errors);

  if (root["format"] !== "yage-level") {
    errors.push({
      path: "format",
      message: 'must be "yage-level"',
    });
  }
  if (root["version"] !== 1) {
    errors.push({
      path: "version",
      message: "must be 1; this parser reads version 1 documents",
    });
  }

  const id = requireNonEmptyString(root["id"], "id", errors);
  const schema = optionalNonEmptyString(root["$schema"], "$schema", errors);
  const metadata = optionalJsonObject(root["metadata"], "metadata", errors);
  const extensions = optionalJsonObject(
    root["extensions"],
    "extensions",
    errors,
  );
  const entities = readPlacements(root["entities"], errors);

  if (id === undefined || errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    document: {
      ...(schema !== undefined ? { $schema: schema } : {}),
      format: "yage-level",
      version: 1,
      id,
      metadata: metadata ?? {},
      entities,
      extensions: extensions ?? {},
    },
  };
}

function parseText(text: string, errors: StructuralError[]): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    errors.push({
      path: "",
      message: `is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

function readPlacements(
  value: unknown,
  errors: StructuralError[],
): readonly LevelPlacement[] {
  if (!Array.isArray(value)) {
    errors.push({ path: "entities", message: "must be an array" });
    return [];
  }

  const read: ReadPlacement[] = [];
  const firstIndexById = new Map<string, number>();
  const firstIndexByDerivedKey = new Map<string, number>();
  value.forEach((entry, index) => {
    const placement = readPlacement(entry, `entities[${index}]`, errors);
    if (!placement) return;
    const first = firstIndexById.get(placement.id);
    if (first !== undefined) {
      errors.push({
        path: `entities[${index}].id`,
        message: `repeats the id of entities[${first}]; a placement id is its identity`,
      });
      return;
    }
    firstIndexById.set(placement.id, index);
    // The runtime scene key is derived from a placement's `key`, or its `id`
    // when it has none, so those two fields share one space: a `key` can
    // collide with another placement's `id`. Two placements that derive one
    // scene key fail the load when the second reservation throws, and the
    // editor's server must reject the file before it reaches a scene. The
    // placement is kept, so the rest of the document still reports its own
    // problems.
    const derived = placement.key ?? placement.id;
    const firstDerived = firstIndexByDerivedKey.get(derived);
    if (firstDerived === undefined) {
      firstIndexByDerivedKey.set(derived, index);
    } else {
      errors.push({
        path: `entities[${index}].${placement.key === undefined ? "id" : "key"}`,
        message: `derives the same scene key as entities[${firstDerived}]; a placement uses its key, or its id when it has none, and two cannot share one`,
      });
    }
    read.push({ placement, index });
  });

  checkHierarchy(read, errors);
  return read.map((entry) => entry.placement);
}

/** A parsed placement, with where it sat in the file — error paths need both. */
interface ReadPlacement {
  readonly placement: LevelPlacement;
  readonly index: number;
}

function readPlacement(
  value: unknown,
  path: string,
  errors: StructuralError[],
): LevelPlacement | undefined {
  const source = requireObject(value, path, errors);
  if (!source) return undefined;

  rejectUnknownFields(source, PLACEMENT_FIELDS, path, errors);

  const id = requireNonEmptyString(source["id"], `${path}.id`, errors);
  const type = requireNonEmptyString(source["type"], `${path}.type`, errors);
  // Required rather than defaulted: it selects which migrations run, so a
  // placement that omits it would silently be migrated from the wrong version.
  const typeVersion = requireInteger(
    source["typeVersion"],
    `${path}.typeVersion`,
    errors,
  );
  const name = optionalNonEmptyString(source["name"], `${path}.name`, errors);
  const key = optionalNonEmptyString(source["key"], `${path}.key`, errors);
  const parent = optionalNonEmptyString(
    source["parent"],
    `${path}.parent`,
    errors,
  );
  const active = optionalBoolean(source["active"], `${path}.active`, errors);
  const transform = readTransform(
    source["transform"],
    `${path}.transform`,
    errors,
  );
  const params = optionalJsonObject(source["params"], `${path}.params`, errors);
  const extensions = optionalJsonObject(
    source["extensions"],
    `${path}.extensions`,
    errors,
  );

  if (id === undefined || type === undefined || typeVersion === undefined) {
    return undefined;
  }

  return {
    id,
    type,
    typeVersion,
    ...(name !== undefined ? { name } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(parent !== undefined ? { parent } : {}),
    active: active ?? true,
    transform: transform ?? IDENTITY_TRANSFORM,
    params: params ?? {},
    extensions: extensions ?? {},
  };
}

const IDENTITY_TRANSFORM: LevelTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
};

function readTransform(
  value: unknown,
  path: string,
  errors: StructuralError[],
): LevelTransform | undefined {
  if (value === undefined) return IDENTITY_TRANSFORM;
  const source = requireObject(value, path, errors);
  if (!source) return undefined;

  rejectUnknownFields(source, ["position", "rotation", "scale"], path, errors);

  const position = readPoint(source["position"], `${path}.position`, errors);
  const scale = readPoint(source["scale"], `${path}.scale`, errors, {
    x: 1,
    y: 1,
  });
  const rotation =
    source["rotation"] === undefined
      ? 0
      : requireFiniteNumber(source["rotation"], `${path}.rotation`, errors);

  if (!position || !scale || rotation === undefined) return undefined;
  return { position, rotation, scale };
}

/**
 * A point, or `absent` when the field is not there.
 *
 * A zero component is a value: a scale of zero is how a placement that pops in
 * under an animation starts. Everything that would divide by a scale keeps the
 * component it has on an axis whose parent scale is zero instead.
 */
function readPoint(
  value: unknown,
  path: string,
  errors: StructuralError[],
  absent: LevelPoint = { x: 0, y: 0 },
): LevelPoint | undefined {
  if (value === undefined) return absent;
  const source = requireObject(value, path, errors);
  if (!source) return undefined;

  rejectUnknownFields(source, ["x", "y"], path, errors);
  const x = requireFiniteNumber(source["x"], `${path}.x`, errors);
  const y = requireFiniteNumber(source["y"], `${path}.y`, errors);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

/**
 * Parent links stay inside the document and form a tree. A link to a missing
 * placement or a cycle is reported against every placement that carries it, so
 * fixing the file does not need a second parse to find the next one.
 */
function checkHierarchy(
  read: readonly ReadPlacement[],
  errors: StructuralError[],
): void {
  const byId = new Map(
    read.map((entry) => [entry.placement.id, entry.placement]),
  );

  for (const { placement, index } of read) {
    const parent = placement.parent;
    if (parent === undefined) continue;
    const path = `entities[${index}].parent`;

    if (parent === placement.id) {
      errors.push({ path, message: "names its own placement" });
      continue;
    }
    if (!byId.has(parent)) {
      errors.push({
        path,
        message: `names "${parent}", which this level does not contain`,
      });
      continue;
    }

    let ancestor = byId.get(parent);
    for (let step = 0; ancestor && step <= read.length; step++) {
      if (ancestor.id === placement.id) {
        errors.push({ path, message: "closes a parent cycle" });
        break;
      }
      ancestor =
        ancestor.parent === undefined ? undefined : byId.get(ancestor.parent);
    }
  }
}

function requireObject(
  value: unknown,
  path: string,
  errors: StructuralError[],
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    errors.push({ path, message: "must be an object" });
    return undefined;
  }
  return value;
}

function rejectUnknownFields(
  source: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: StructuralError[],
): void {
  for (const field of Object.keys(source)) {
    if (allowed.includes(field)) continue;
    errors.push({
      path: path === "" ? field : `${path}.${field}`,
      message:
        "is not a field of this format; put your own data under extensions",
    });
  }
}

function requireNonEmptyString(
  value: unknown,
  path: string,
  errors: StructuralError[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ path, message: "must be a non-empty string" });
    return undefined;
  }
  return value;
}

function optionalNonEmptyString(
  value: unknown,
  path: string,
  errors: StructuralError[],
): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, path, errors);
}

function requireFiniteNumber(
  value: unknown,
  path: string,
  errors: StructuralError[],
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ path, message: "must be a finite number" });
    return undefined;
  }
  return value;
}

function requireInteger(
  value: unknown,
  path: string,
  errors: StructuralError[],
): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    errors.push({
      path,
      message: "must be an integer of 1 or more",
    });
    return undefined;
  }
  return value;
}

function optionalBoolean(
  value: unknown,
  path: string,
  errors: StructuralError[],
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    errors.push({ path, message: "must be a boolean" });
    return undefined;
  }
  return value;
}

function optionalJsonObject(
  value: unknown,
  path: string,
  errors: StructuralError[],
): JsonObject | undefined {
  if (value === undefined) return undefined;
  const source = requireObject(value, path, errors);
  if (!source) return undefined;
  if (!isJsonValue(source, 0, path, errors)) return undefined;
  return source as JsonObject;
}
