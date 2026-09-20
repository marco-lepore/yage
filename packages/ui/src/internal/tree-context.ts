/**
 * What an element needs from the UI tree it hangs in: the name a development
 * warning prints, and the scene's focus stack a `focus` panel registers its
 * scope with. `UISurface` stamps the context on its root panel and containers
 * pass it on as children are added.
 */

import type { UIFocusStack } from "../focus/UIFocusStack.js";
import type { UIElement } from "../types.js";

/** What a container hands each of its children. */
export interface UITreeContext {
  /**
   * Name of the owning UI tree, printed as a prefix by development warnings.
   * `undefined` for an element built outside a surface.
   */
  readonly label: string | undefined;
  /**
   * The scene's focus stack, which every scope in this tree registers with.
   * `null` for a tree built outside a scene, where scopes work but read no
   * device input.
   */
  readonly focusStack: UIFocusStack | null;
}

/**
 * Pass the tree context to one child, if that child takes one. Most leaf
 * elements leave `_attachToTree` out, which costs them only the warning
 * prefix and the ability to host a scope.
 */
export function attachChildToTree(
  child: UIElement,
  context: UITreeContext | undefined,
): void {
  if (context === undefined) return;
  child._attachToTree?.(context);
}

/** Pass the tree context to every child in a list. */
export function attachChildrenToTree(
  children: readonly UIElement[],
  context: UITreeContext | undefined,
): void {
  if (context === undefined) return;
  for (const child of children) child._attachToTree?.(context);
}

/** Drop one child's tree context, unregistering any scope it hosts. */
export function detachChildFromTree(child: UIElement): void {
  child._detachFromTree?.();
}
