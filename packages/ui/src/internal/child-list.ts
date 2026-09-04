import type { DisplayContainer } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import type { UIElement } from "../types.js";

interface ChildListOwner {
  children: UIElement[];
  container: DisplayContainer;
  yogaNode: YogaNode;
}

function detach(owner: ChildListOwner, child: UIElement): number {
  const index = owner.children.indexOf(child);
  if (index === -1 && child.displayObject.parent !== owner.container) return -1;
  if (child.yogaNode.getParent() !== null) {
    owner.yogaNode.removeChild(child.yogaNode);
  }
  if (index !== -1) owner.children.splice(index, 1);
  if (child.displayObject.parent === owner.container) {
    owner.container.removeChild(child.displayObject);
  }
  return index;
}

function prepareInsert(
  owner: ChildListOwner,
  child: UIElement,
  context: string,
): void {
  if (
    owner.children.includes(child) ||
    child.displayObject.parent === owner.container
  ) {
    detach(owner, child);
    return;
  }
  const parent = child.yogaNode.getParent();
  if (parent !== null) {
    throw new Error(
      `${context}: the element is already a child of another container; ` +
        "remove it there first.",
    );
  }
}

export function addChild(
  owner: ChildListOwner,
  child: UIElement,
  context: string,
): void {
  prepareInsert(owner, child, context);
  const index = owner.children.length;
  owner.yogaNode.insertChild(child.yogaNode, index);
  owner.children.push(child);
  owner.container.addChild(child.displayObject);
}

export function insertChildBefore(
  owner: ChildListOwner,
  child: UIElement,
  before: UIElement,
  context: string,
): void {
  prepareInsert(owner, child, context);
  const beforeIndex = owner.children.indexOf(before);
  if (beforeIndex === -1) {
    addChild(owner, child, context);
    return;
  }

  owner.yogaNode.insertChild(child.yogaNode, beforeIndex);
  owner.children.splice(beforeIndex, 0, child);
  const displayIndex = owner.container.children.indexOf(before.displayObject);
  if (displayIndex === -1) owner.container.addChild(child.displayObject);
  else owner.container.addChildAt(child.displayObject, displayIndex);
}

export function removeChild(owner: ChildListOwner, child: UIElement): boolean {
  return detach(owner, child) !== -1;
}
