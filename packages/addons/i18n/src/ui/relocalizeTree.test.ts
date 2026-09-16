import type { UIContainerElement, UIElement } from "@yagejs/ui";
import { describe, expect, it } from "vitest";
import { msg, type MessageResolver } from "../core/message.js";
import { relocalizeTree } from "./relocalizeTree.js";

const stub = {
  displayObject: {},
  yogaNode: {},
  visible: true,
} as unknown as UIElement;

function leaf(): UIElement & {
  seen: string[];
  relocalize: (r: MessageResolver) => void;
} {
  const seen: string[] = [];
  return {
    ...stub,
    seen,
    relocalize: (resolve) => seen.push(resolve(msg("k", "fallback"))),
    update: () => undefined,
    destroy: () => undefined,
  };
}

function panel(children: UIElement[]): UIContainerElement {
  return {
    ...stub,
    children,
    addElement: () => undefined,
    removeElement: () => undefined,
    insertElementBefore: () => undefined,
    update: () => undefined,
    destroy: () => undefined,
  };
}

describe("relocalizeTree", () => {
  it("reaches relocalizable elements at every depth and skips the rest", () => {
    const deep = leaf();
    const top = leaf();
    const plain = {
      ...stub,
      update: () => undefined,
      destroy: () => undefined,
    };
    const root = panel([top, plain, panel([panel([deep])])]);
    relocalizeTree(root, (m) => `it:${m.key}`);
    expect(top.seen).toEqual(["it:k"]);
    expect(deep.seen).toEqual(["it:k"]);
  });
});
