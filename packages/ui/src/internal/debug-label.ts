/**
 * Internal threading for the name a development-mode warning prints to say
 * which UI tree it came from. `UISurface` stamps the owning entity's name on
 * its root panel; containers pass it down as children are added, so a warning
 * raised deep in the tree still names the entity. An element built outside a
 * surface has no label and its warnings print without the prefix.
 */

/** @internal */
export interface DebugLabelled {
  _setDebugLabel(label: string | undefined): void;
}

/** Pass a label to one child, if that child tracks one. */
export function setChildDebugLabel(
  child: unknown,
  label: string | undefined,
): void {
  if (label === undefined) return;
  const target = child as Partial<DebugLabelled>;
  if (typeof target._setDebugLabel === "function") {
    target._setDebugLabel(label);
  }
}

/** Pass a label to every child in a list. */
export function setChildrenDebugLabel(
  children: readonly unknown[],
  label: string | undefined,
): void {
  if (label === undefined) return;
  for (const child of children) setChildDebugLabel(child, label);
}
