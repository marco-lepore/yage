import type { JsonValue } from "@yagejs/level/document";

/**
 * Paths the structured inspector can write as one atomic value command: the
 * whole parameter object, any value inside it however deep, the type version,
 * or one of the placement fields a document may leave out.
 *
 * Depth is not capped here. A parameter can hold an object of arrays of
 * objects, and every level of it is edited at its own path; what a level may
 * declare is capped where the declaration is read, when the catalog is built.
 * An array element is named by its position written as a decimal string, so
 * one path type carries every segment.
 */
export function isValueEditPath(path: readonly string[]): boolean {
  if (path.length === 1) {
    return (
      path[0] === "params" ||
      path[0] === "typeVersion" ||
      isOptionalFieldPath(path)
    );
  }
  return path.length > 1 && path[0] === "params";
}

/** The placement fields a value edit may clear with `null`. */
const OPTIONAL_FIELDS: readonly string[] = ["name", "key", "layer"];

/**
 * Whether the path names a placement field the format lets a document leave
 * out, where a value edit uses `null` for "the field is not there".
 *
 * `readLevel` refuses a `name`, a `key` or a `layer` that is not a non-empty
 * string, so a document can never hold `null` at any of them and the two
 * meanings cannot be confused. `parent` is the one other optional field, and it
 * moves through `move-placements`; every other path a value edit accepts is
 * always present.
 */
export function isOptionalFieldPath(path: readonly string[]): boolean {
  return path.length === 1 && OPTIONAL_FIELDS.includes(path[0] as string);
}

/** What {@link valueAtPath} returns when no value sits at the path. */
export const MISSING_VALUE = Symbol("missing value");

/**
 * The value at `path` inside a placement or a parameter object, or
 * {@link MISSING_VALUE} when any step of it is not there.
 *
 * Own and enumerable properties only, which is every property a parsed
 * document has and no other: an inherited `toString` is not a value the
 * document holds, and neither is an array's `length` — a path to one of those
 * reaches nothing rather than something to read or write over.
 */
export function valueAtPath(
  container: object,
  path: readonly string[],
): JsonValue | typeof MISSING_VALUE {
  let current: unknown = container;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return MISSING_VALUE;
    if (!holdsOwn(current, segment)) return MISSING_VALUE;
    current = Reflect.get(current, segment);
  }
  return current as JsonValue;
}

/** Whether the container holds this segment as a value of its own. */
function holdsOwn(container: object, segment: string): boolean {
  return (
    Object.getOwnPropertyDescriptor(container, segment)?.enumerable === true
  );
}
