import type { JsonObject, LevelDocument, LevelPlacement } from "./types.js";

/**
 * Write a level document in its canonical form: two-space indent, one fixed
 * field order, and a final newline.
 *
 * The same document always produces the same bytes, whatever order its fields
 * were built in — the output is constructed here rather than handed to
 * `JSON.stringify` as it arrived. That is what lets a content hash mean
 * "changed", and what keeps a saved file's diff down to the edit.
 *
 * Fields carrying their default are left out: an empty `params`, `metadata`,
 * or `extensions`, an `active` placement, and an identity transform. Reading
 * the result back gives the same document.
 */
export function formatLevel(document: LevelDocument): string {
  const canonical: Record<string, unknown> = {};
  if (document.$schema !== undefined) canonical["$schema"] = document.$schema;
  canonical["format"] = document.format;
  canonical["version"] = document.version;
  canonical["id"] = document.id;
  if (hasEntries(document.metadata))
    canonical["metadata"] = sortJson(document.metadata);
  canonical["entities"] = document.entities.map(canonicalPlacement);
  if (hasEntries(document.extensions)) {
    canonical["extensions"] = sortJson(document.extensions);
  }

  return `${JSON.stringify(canonical, null, 2)}\n`;
}

function canonicalPlacement(
  placement: LevelPlacement,
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    id: placement.id,
    type: placement.type,
    typeVersion: placement.typeVersion,
  };
  if (placement.name !== undefined) canonical["name"] = placement.name;
  if (placement.key !== undefined) canonical["key"] = placement.key;
  if (placement.parent !== undefined) canonical["parent"] = placement.parent;
  if (!placement.active) canonical["active"] = false;

  const { position, rotation, scale } = placement.transform;
  const identity =
    position.x === 0 &&
    position.y === 0 &&
    rotation === 0 &&
    scale.x === 1 &&
    scale.y === 1;
  if (!identity) {
    canonical["transform"] = {
      position: { x: position.x, y: position.y },
      rotation,
      scale: { x: scale.x, y: scale.y },
    };
  }

  if (hasEntries(placement.params))
    canonical["params"] = sortJson(placement.params);
  if (hasEntries(placement.extensions)) {
    canonical["extensions"] = sortJson(placement.extensions);
  }
  return canonical;
}

/**
 * Order object keys, so two documents that differ only in the order a `params`
 * object was built produce the same bytes. Array order is data and is kept.
 */
function sortJson(value: JsonObject): Record<string, unknown> {
  // Null prototype, because a plain object's `__proto__` is a setter: writing
  // that key would re-parent the accumulator instead of storing the value, and
  // the entry would vanish from the file.
  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue(value[key]);
  }
  return sorted;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value === "object" && value !== null) {
    return sortJson(value as JsonObject);
  }
  return value;
}

function hasEntries(value: JsonObject): boolean {
  return Object.keys(value).length > 0;
}
