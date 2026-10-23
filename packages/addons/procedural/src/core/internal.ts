/** Authored errors for invalid input, and frozen copies of caller data. */
export function fail(message: string): never {
  throw new Error(`Procedural: ${message}`);
}
export function assertInteger(
  context: string,
  value: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(
      `${context}: integer in [${min}, ${max === Number.MAX_SAFE_INTEGER ? "∞" : max}] required, got ${value}`,
    );
}
export function assertPositive(context: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    fail(`${context}: finite positive number required, got ${value}`);
}
/** Generation runs across frames, so inputs are copied before the first step. */
export function freezeCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export function hasAll(
  required: readonly string[] | undefined,
  hasKey: (key: string) => boolean,
): boolean {
  return (required ?? []).every(hasKey);
}
