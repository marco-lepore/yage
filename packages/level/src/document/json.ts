import type { JsonValue, StructuralError } from "./types.js";

/**
 * How deep a `params`, `metadata`, or `extensions` value may nest. `JSON.parse`
 * accepts far deeper than anything that walks the result recursively survives,
 * so the parser is where the bound belongs.
 */
const MAX_JSON_DEPTH = 64;

/**
 * Whether `value` is JSON all the way down, collecting each reason it is not.
 *
 * Two layers need this. The parser accepts data that has already been through
 * `JSON.parse` as well as a string, so an object handed to it need not hold
 * JSON at all. Preparation runs migrations written by the developer, and what
 * one returns is written back into a placement's `params`.
 */
export function isJsonValue(
  value: unknown,
  depth: number,
  path: string,
  errors: StructuralError[],
): boolean {
  if (depth > MAX_JSON_DEPTH) {
    errors.push({
      path,
      message: `nests deeper than ${MAX_JSON_DEPTH} levels`,
    });
    return false;
  }
  if (value === null) return true;

  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      if (Number.isFinite(value)) return true;
      errors.push({
        path,
        message: "is not a finite number, and JSON cannot store it",
      });
      return false;
    case "object":
      break;
    default:
      errors.push({
        path,
        message: `is a ${typeof value}, which JSON cannot store`,
      });
      return false;
  }

  if (Array.isArray(value)) {
    return value.every((entry, index) =>
      isJsonValue(entry, depth + 1, `${path}[${index}]`, errors),
    );
  }
  if (!isPlainObject(value)) {
    errors.push({ path, message: "is not a plain object" });
    return false;
  }
  return Object.entries(value).every(([key, entry]) =>
    isJsonValue(entry as JsonValue, depth + 1, `${path}.${key}`, errors),
  );
}

/**
 * An object literal, and not a `Date`, a `Map`, or any other class instance.
 * Those survive a `typeof` check and serialize to something else entirely — a
 * `Date` writes itself as a string, a `Map` as `{}` — so the shape has to be
 * checked by prototype.
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
