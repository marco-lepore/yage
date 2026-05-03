/**
 * Cross-package WeakSet for marking display containers (Pixi `Container`s in
 * the canonical setup) as "swallow pointer input." The `@yagejs/input`
 * package's drain step consults this set via the renderer's optional
 * `hitTestUI(x, y)` — when the topmost interactive container under a
 * `pointerdown` is parented to a marked container, the pointer is auto-claimed
 * (`consumePointer`-equivalent), so the press never propagates to gameplay
 * action-map edges like `MouseLeft`.
 *
 * Lives in `@yagejs/core` so the renderer (read side) and the UI / sprite
 * components (write side) can both reach it without circular imports.
 *
 * Untyped on `Container` to keep `@yagejs/core` free of any Pixi dependency.
 * Callers pass their `Pixi.Container` instances directly; `WeakSet` accepts
 * any object reference.
 */

const registry = new WeakSet<object>();

/**
 * Mark a display container as a UI-input surface. Idempotent. Call from a
 * component's `onAdd` (or equivalent) after the underlying Pixi container is
 * created.
 */
export function markPointerConsumeContainer(container: object): void {
  registry.add(container);
}

/**
 * Remove the mark. Call from a component's `onDestroy` for symmetry, or to
 * implement an opt-out (`consumeInput: false`) escape hatch on UI primitives.
 */
export function unmarkPointerConsumeContainer(container: object): void {
  registry.delete(container);
}

/** Whether a container has been marked as a UI-input surface. */
export function isPointerConsumeContainer(container: object): boolean {
  return registry.has(container);
}
