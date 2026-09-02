/** Paths the structured inspector can write as one atomic value command. */
export function isValueEditPath(path: readonly string[]): boolean {
  if (path.length === 1) {
    return (
      path[0] === "params" ||
      path[0] === "typeVersion" ||
      isOptionalFieldPath(path)
    );
  }
  return path.length === 2 && path[0] === "params";
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
