/** What a thrown value says, whether or not it is an `Error`. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A value's type, bare, for a message that supplies its own article — "is
 * ${typeName(x)}, not an entity class".
 */
export function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

/**
 * A value with its article, naming the class when there is one. A migration
 * that returns a `Map` should be told it returned a `Map`, not "an object".
 */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") {
    const name = (value as { constructor?: { name?: string } }).constructor
      ?.name;
    return name === undefined || name === "" ? "an object" : `a ${name}`;
  }
  return `a ${typeof value}`;
}
