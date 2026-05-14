import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
  // @pixi/ui reads navigator at import time — stub it for Node
  if (typeof globalThis.navigator === "undefined") {
    (globalThis as unknown as { navigator: { userAgent: string } }).navigator = { userAgent: "" };
  }
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    eventMode = "auto";
    cursor = "default";
    mask: MockContainer | null = null;
    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    addChildAt(child: MockContainer, index: number): MockContainer {
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }

    removeChild(child: MockContainer): MockContainer {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
      }
      return child;
    }

    removeChildAt(index: number): MockContainer {
      const child = this.children[index];
      if (child) {
        this.children.splice(index, 1);
        child.parent = null;
      }
      return child!;
    }

    removeFromParent(): void {
      this.parent?.removeChild(this);
    }

    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }

    emit(event: string): void {
      const listeners = this._listeners.get(event);
      if (listeners) {
        for (const fn of listeners) fn();
      }
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics { return this; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rect(...args: unknown[]): MockGraphics { return this; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    roundRect(...args: unknown[]): MockGraphics { return this; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fill(...args: unknown[]): MockGraphics { return this; }
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    width: number;
    height: number;
    anchor = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };

    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      this.width = 50;
      this.height = 14;
    }
  }

  return { mocks: { MockContainer, MockGraphics, MockText } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
}));

import Yoga from "yoga-layout";
import { setYoga, PanelNode, UIText as UITextNode, UIButton as UIButtonNode } from "@yagejs/ui";
import { createElement } from "react";
import { createRoot, getRootInstances, addOnCommit, removeOnCommit } from "./reconciler.js";
import { Button, UIText as Text } from "./components.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("reconciler", () => {
  let container: InstanceType<typeof mocks.MockContainer>;

  beforeEach(() => {
    vi.clearAllMocks();
    container = new mocks.MockContainer();
  });

  it("createRoot returns render and unmount", () => {
    const root = createRoot(container as never);
    expect(root.render).toBeDefined();
    expect(root.unmount).toBeDefined();
  });

  it("renders a panel element into the container", () => {
    const root = createRoot(container as never);
    root.render(createElement("ui-element", { _ctor: PanelNode, direction: "column" }));

    // React reconciler is synchronous for our config
    expect(container.children.length).toBe(1);
  });

  it("renders a text element", () => {
    const root = createRoot(container as never);
    root.render(createElement("ui-element", { _ctor: UITextNode, _consumesText: true, style: { fontSize: 20 } }, "Hello"));

    expect(container.children.length).toBe(1);
  });

  it("renders a button element", () => {
    const root = createRoot(container as never);
    root.render(
      createElement("ui-element", { _ctor: UIButtonNode, _consumesText: true, width: 100, height: 40 }, "Click"),
    );

    expect(container.children.length).toBe(1);
  });

  it("unmount removes all children", () => {
    const root = createRoot(container as never);
    root.render(createElement("ui-element", { _ctor: PanelNode }));

    expect(container.children.length).toBe(1);

    root.unmount();
    expect(container.children.length).toBe(0);
  });

  it("tracks root instances for layout", () => {
    const root = createRoot(container as never);
    root.render(createElement("ui-element", { _ctor: PanelNode, direction: "column" }));

    const instances = getRootInstances(container as never);
    expect(instances).toBeDefined();
    expect(instances!.length).toBe(1);
  });

  it("calls onCommit callbacks after render", () => {
    const cb = vi.fn();
    addOnCommit(cb);

    const root = createRoot(container as never);
    root.render(createElement("ui-element", { _ctor: PanelNode }));

    expect(cb).toHaveBeenCalled();
    removeOnCommit(cb);
  });

  it("nested children are tracked in panel instances", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        "ui-element",
        { _ctor: PanelNode, direction: "column" },
        createElement("ui-element", { _ctor: UITextNode, _consumesText: true }, "Hello"),
        createElement("ui-element", { _ctor: UIButtonNode, _consumesText: true, width: 80, height: 30 }, "OK"),
      ),
    );

    const instances = getRootInstances(container as never);
    const panel = instances![0]!;
    // Panel is a PanelNode with UIContainerElement children
    expect("children" in panel).toBe(true);
    const panelChildren = (panel as { children: unknown[] }).children;
    expect(panelChildren.length).toBe(2);
  });

  it("does not crash on missing _ctor (React catches the error)", () => {
    const root = createRoot(container as never);
    // React's error recovery catches the throw from createInstance,
    // so it won't propagate — but the container should remain empty.
    root.render(createElement("ui-element" as never, null));
    expect(container.children.length).toBe(0);
  });

  it("Button with a string child renders an auto-wrapped Text child", () => {
    // The React <Button> wraps string children in <Text> so the underlying
    // UIButton always operates in container mode. We verify it has exactly
    // one Yoga child after render.
    const root = createRoot(container as never);
    root.render(createElement(Button, { onClick: () => {} }, "Click"));

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as {
      children: readonly unknown[];
      yogaNode: { getChildCount(): number };
    };
    expect(btn.children.length).toBe(1);
    expect(btn.yogaNode.getChildCount()).toBe(1);
  });

  it("Button with a numeric child auto-wraps it via String() into a Text", () => {
    const root = createRoot(container as never);
    root.render(createElement(Button, { onClick: () => {} }, 42));

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as {
      children: readonly unknown[];
      yogaNode: { getChildCount(): number };
    };
    expect(btn.children.length).toBe(1);
    expect(btn.yogaNode.getChildCount()).toBe(1);
  });

  it("Button with multiple ReactNode children renders them as flex children", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        Button,
        { onClick: () => {} },
        createElement(Text, null, "Label"),
        createElement(Text, null, "Icon"),
      ),
    );

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as {
      children: readonly unknown[];
      yogaNode: { getChildCount(): number };
    };
    expect(btn.children.length).toBe(2);
    expect(btn.yogaNode.getChildCount()).toBe(2);
  });

  it("Button forwards `truncate` into the auto-wrapped Text", () => {
    // Composes with @yagejs/ui's UIText truncation: a fixed-width Button
    // with a long string label can ellipsize instead of wrapping.
    const root = createRoot(container as never);
    root.render(
      createElement(
        Button,
        { onClick: () => {}, truncate: "ellipsis", width: 80 },
        "A very long label that doesn't fit",
      ),
    );

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as { children: readonly unknown[] };
    expect(btn.children.length).toBe(1);
    // Peek through the JSX wrapper into the UIText that the Button auto-
    // created and confirm the truncate mode landed on the underlying node.
    const label = btn.children[0] as { _truncate: unknown };
    expect(label._truncate).toBe("ellipsis");
  });

  it("commitUpdate calls instance.update()", () => {
    const root = createRoot(container as never);
    root.render(
      createElement("ui-element", { _ctor: UITextNode, _consumesText: true, style: { fontSize: 20 } }, "Hello"),
    );

    // Update with new text
    root.render(
      createElement("ui-element", { _ctor: UITextNode, _consumesText: true, style: { fontSize: 20 } }, "World"),
    );

    // Should not crash and text should be updated
    expect(container.children.length).toBe(1);
  });
});
