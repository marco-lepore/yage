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

/**
 * Whether the path names a placement field the format lets a document leave
 * out, where a value edit uses `null` for "the field is not there".
 *
 * `readLevel` refuses a `name` or a `key` that is not a non-empty string, so a
 * document can never hold `null` at either path and the two meanings cannot be
 * confused. Nothing else in a placement is both optional and writable: `parent`
 * is optional and moves through `move-placements`, and every other path a value
 * edit accepts is always present.
 */
export function isOptionalFieldPath(path: readonly string[]): boolean {
  return path.length === 1 && (path[0] === "name" || path[0] === "key");
}
