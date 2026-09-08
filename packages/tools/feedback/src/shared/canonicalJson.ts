import { copyJson } from "./protocol.js";
import type { Json } from "./protocol.js";

/** Object key order is not part of evidence identity; array order is. */
export function canonicalJson(value: unknown): string {
  function sort(value: Json): Json {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sort(value[key] as Json)]),
      );
    return value;
  }
  return JSON.stringify(sort(copyJson(value)));
}
