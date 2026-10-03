/**
 * A display object's pointer-consumption setting. `"inherit"` identifies UI
 * that uses the nearest ancestor's explicit setting, defaulting to true when
 * no ancestor specifies one. Unregistered display objects have no UI default.
 */
export type PointerConsumePolicy = boolean | "inherit";

const registry = new WeakMap<object, PointerConsumePolicy>();

/**
 * Set a display object's pointer-consumption policy. The renderer resolves
 * the nearest explicit boolean on the hit path. This does not change hit
 * testing or pointer callbacks; custom containers must configure those too.
 */
export function markPointerConsumeContainer(
  container: object,
  policy: PointerConsumePolicy = true,
): void {
  registry.set(container, policy);
}

/** Remove this display object's policy, including its UI default. */
export function unmarkPointerConsumeContainer(container: object): void {
  registry.delete(container);
}

/** Read this display object's own policy without resolving its ancestors. */
export function getPointerConsumePolicy(
  container: object,
): PointerConsumePolicy | undefined {
  return registry.get(container);
}

/** Whether this display object explicitly consumes input. */
export function isPointerConsumeContainer(container: object): boolean {
  return registry.get(container) === true;
}
