import type { UIContainerElement, UIElement } from "@yagejs/ui";
import { isRelocalizable } from "../core/Localization.js";
import type { MessageResolver } from "../core/message.js";

function isContainer(element: UIElement): element is UIContainerElement {
  return Array.isArray((element as UIContainerElement).children);
}

/**
 * Call `relocalize` on `root` and on every descendant that implements it,
 * recursing through each element that exposes `children`.
 */
export function relocalizeTree(
  root: UIElement,
  resolve: MessageResolver,
): void {
  if (isRelocalizable(root)) root.relocalize(resolve);
  if (!isContainer(root)) return;
  for (const child of root.children) relocalizeTree(child, resolve);
}
