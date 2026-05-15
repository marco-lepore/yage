import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Direction } from "yoga-layout";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
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
    maskInverse = false;
    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    setMask(opts: { mask: MockContainer | null; inverse?: boolean }): void {
      this.mask = opts.mask;
      this.maskInverse = opts.inverse ?? false;
    }

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

    removeFromParent(): void {
      this.parent?.removeChild(this);
    }

    on(event: string, fn: (...args: unknown[]) => void): void {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
    }

    off(event: string, fn: (...args: unknown[]) => void): void {
      this._listeners.get(event)?.delete(fn);
    }

    emit(event: string, payload: unknown): void {
      for (const fn of this._listeners.get(event) ?? []) fn(payload);
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rect(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    roundRect(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fill(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    stroke(...args: unknown[]): MockGraphics {
      return this;
    }
  }

  return { mocks: { MockContainer, MockGraphics } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
}));

import Yoga from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { ScrollViewNode } from "./ScrollView.js";
import { PanelNode } from "./UIPanel.js";

beforeAll(() => {
  setYoga(Yoga);
});

/** Build a ScrollView with `n` fixed-height rows and run a layout pass. */
function buildScrollView(
  rows: number,
  opts: { height?: number; rowHeight?: number } = {},
): { sv: ScrollViewNode; rowsArr: PanelNode[] } {
  const height = opts.height ?? 100;
  const rowHeight = opts.rowHeight ?? 30;
  const sv = new ScrollViewNode({ width: 200, height });
  const rowsArr: PanelNode[] = [];
  for (let i = 0; i < rows; i++) {
    const row = new PanelNode({ height: rowHeight, width: 200 });
    rowsArr.push(row);
    sv.addElement(row);
  }
  layout(sv);
  return { sv, rowsArr };
}

function layout(sv: ScrollViewNode): void {
  sv.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
  sv.applyLayout();
}

describe("ScrollViewNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates children to the content subtree", () => {
    const { sv, rowsArr } = buildScrollView(3);
    expect(sv.children).toHaveLength(3);
    expect(sv.children).toEqual(rowsArr);
  });

  it("masks the viewport for clipping", () => {
    const { sv } = buildScrollView(3);
    expect(
      (sv.displayObject as unknown as { mask: unknown }).mask,
    ).not.toBeNull();
  });

  it("has no scroll range when content fits the viewport", () => {
    const { sv } = buildScrollView(3, { height: 100, rowHeight: 30 }); // 90 < 100
    expect(sv.maxScroll).toBe(0);
  });

  it("computes scroll range from overflowing content", () => {
    const { sv } = buildScrollView(5, { height: 100, rowHeight: 30 }); // 150 > 100
    expect(sv.maxScroll).toBe(50);
  });

  it("scrollBy clamps within [0, maxScroll] and pans content", () => {
    const { sv } = buildScrollView(5, { height: 100, rowHeight: 30 });
    const content = (sv as unknown as { content: PanelNode }).content;

    sv.scrollBy(20);
    expect(sv.scrollOffset).toBe(20);
    expect(content.container.position.y).toBe(-20);

    sv.scrollBy(1000);
    expect(sv.scrollOffset).toBe(50); // clamped to maxScroll

    sv.scrollBy(-1000);
    expect(sv.scrollOffset).toBe(0); // clamped to 0
  });

  it("re-clamps the offset when the list shrinks below the viewport", () => {
    const { sv, rowsArr } = buildScrollView(5, { height: 100, rowHeight: 30 });
    sv.scrollTo(50);
    expect(sv.scrollOffset).toBe(50);

    // Fulfil orders → content now 60px < 100px viewport.
    sv.removeElement(rowsArr[4]!);
    sv.removeElement(rowsArr[3]!);
    sv.removeElement(rowsArr[2]!);
    layout(sv);

    expect(sv.maxScroll).toBe(0);
    expect(sv.scrollOffset).toBe(0);
  });

  it("preserves scroll position across update() + a children diff", () => {
    const { sv, rowsArr } = buildScrollView(8, { height: 100, rowHeight: 30 });
    sv.scrollTo(60);
    expect(sv.scrollOffset).toBe(60);

    // Simulate a store-driven re-render: props update + one row removed.
    sv.update({ gap: 0 });
    sv.removeElement(rowsArr[0]!);
    layout(sv);

    // 7 rows * 30 = 210, viewport 100 → maxScroll 110, so 60 is still valid.
    expect(sv.maxScroll).toBe(110);
    expect(sv.scrollOffset).toBe(60);
  });

  it("add / remove / insertElementBefore reorder children", () => {
    const sv = new ScrollViewNode({ width: 200, height: 100 });
    const a = new PanelNode({ height: 30 });
    const b = new PanelNode({ height: 30 });
    const c = new PanelNode({ height: 30 });
    const d = new PanelNode({ height: 30 });
    sv.addElement(a);
    sv.addElement(b);
    sv.addElement(c);
    sv.insertElementBefore(d, b);
    expect(sv.children).toEqual([a, d, b, c]);
    sv.removeElement(d);
    expect(sv.children).toEqual([a, b, c]);
  });

  it("scrolls on a federated wheel event", () => {
    const { sv } = buildScrollView(5, { height: 100, rowHeight: 30 });
    const viewport = sv.displayObject as unknown as {
      emit(e: string, p: unknown): void;
    };
    viewport.emit("wheel", { deltaY: 24, deltaX: 0, deltaMode: 0 });
    expect(sv.scrollOffset).toBe(24);
  });

  it("fires onScroll only when the offset changes", () => {
    const onScroll = vi.fn();
    const sv = new ScrollViewNode({ width: 200, height: 100, onScroll });
    for (let i = 0; i < 5; i++) sv.addElement(new PanelNode({ height: 30 }));
    layout(sv);

    sv.scrollTo(20);
    sv.scrollTo(20); // no change → no extra call
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onScroll).toHaveBeenLastCalledWith(20);
  });

  it("survives destroy()", () => {
    const { sv } = buildScrollView(3);
    expect(() => sv.destroy()).not.toThrow();
  });
});
