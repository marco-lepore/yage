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

  class MockRectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }

  return { mocks: { MockContainer, MockGraphics, MockRectangle } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Rectangle: mocks.MockRectangle,
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

  it("update({ direction }) flips the scroll axis and resets the offset", () => {
    const { sv } = buildScrollView(5, { height: 100, rowHeight: 30 });
    const content = (sv as unknown as { content: PanelNode }).content;
    sv.scrollTo(30);
    expect(sv.scrollOffset).toBe(30);

    sv.update({ direction: "horizontal" });
    layout(sv);

    // Axis changed → offset cleared; content now overflows on width
    // (5 rows * 200px = 1000 vs 200px viewport).
    expect(sv.scrollOffset).toBe(0);
    expect(sv.maxScroll).toBe(800);

    sv.scrollBy(40);
    expect(sv.scrollOffset).toBe(40);
    expect(content.container.position.x).toBe(-40);
    expect(content.container.position.y).toBe(0);
  });

  it("notifies onScroll(0) when a direction flip resets the offset", () => {
    const onScroll = vi.fn();
    const sv = new ScrollViewNode({ width: 200, height: 100, onScroll });
    for (let i = 0; i < 5; i++) sv.addElement(new PanelNode({ height: 30 }));
    layout(sv);

    sv.scrollTo(30);
    expect(onScroll).toHaveBeenLastCalledWith(30);

    sv.update({ direction: "horizontal" });
    layout(sv);

    // The reset must reach consumers mirroring scroll state.
    expect(sv.scrollOffset).toBe(0);
    expect(onScroll).toHaveBeenLastCalledWith(0);
  });

  it("sets a viewport hitArea synced to the viewport box", () => {
    const { sv } = buildScrollView(5, { height: 100 });
    const hit = (
      sv.displayObject as unknown as {
        hitArea: { x: number; y: number; width: number; height: number };
      }
    ).hitArea;
    // Independent of child coverage — wheel/drag work over gaps & gutter.
    expect(hit).toBeDefined();
    expect(hit.x).toBe(0);
    expect(hit.y).toBe(0);
    expect(hit.width).toBe(200);
    expect(hit.height).toBe(100);
  });

  it("reserves a scrollbar gutter that insets content; none when disabled", () => {
    const { sv } = buildScrollView(5, { height: 100 });
    const content = (sv as unknown as { content: PanelNode }).content;
    // Default thumb: thickness 4 + margin 2*2 = 8.
    expect(sv.scrollbarGutter).toBe(8);
    expect(content.yogaNode.getComputedWidth()).toBe(192); // 200 - gutter

    const off = new ScrollViewNode({ width: 200, height: 100, scrollbar: false });
    for (let i = 0; i < 5; i++) off.addElement(new PanelNode({ height: 30 }));
    layout(off);
    const offContent = (off as unknown as { content: PanelNode }).content;
    expect(off.scrollbarGutter).toBe(0);
    expect(offContent.yogaNode.getComputedWidth()).toBe(200);
  });

  it("honors custom scrollbar size and reconfigures on update()", () => {
    const sv = new ScrollViewNode({
      width: 200,
      height: 100,
      scrollbar: { thickness: 10, margin: 3 },
    });
    for (let i = 0; i < 5; i++) sv.addElement(new PanelNode({ height: 30 }));
    layout(sv);
    const content = (sv as unknown as { content: PanelNode }).content;
    expect(sv.scrollbarGutter).toBe(16); // 10 + 3*2
    expect(content.yogaNode.getComputedWidth()).toBe(184);

    sv.update({ scrollbar: false });
    layout(sv);
    expect(sv.scrollbarGutter).toBe(0);
    expect(content.yogaNode.getComputedWidth()).toBe(200);
  });

  it("is bounded by a flex parent so it scrolls when nested (flexGrow:1)", () => {
    // Regression: the viewport is a flex child of a fixed-height panel and
    // its own content (flexShrink:0) overflows. Without min-size 0 +
    // flexShrink:1 the viewport grows to the content and maxScroll === 0.
    const parent = new PanelNode({
      direction: "column",
      width: 200,
      height: 100,
    });
    const sv = new ScrollViewNode({ flexGrow: 1 });
    for (let i = 0; i < 8; i++) {
      sv.addElement(new PanelNode({ height: 30, width: 200 })); // 240 total
    }
    parent.addElement(sv);
    const footer = new PanelNode({ height: 20 }); // fixed footer sibling
    parent.addElement(footer);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(sv.maxScroll).toBeGreaterThan(0);
    // The fixed footer keeps its 20px and the scroll viewport fills the rest:
    // a flexGrow scroll viewport zeroes its own main-axis basis (web `flex: 1`)
    // so it absorbs the free space instead of letting its overflowing content
    // over-subscribe the column and push the footer out.
    expect(footer.yogaNode.getComputedHeight()).toBe(20);
    expect(sv.yogaNode.getComputedHeight()).toBe(80); // 100 parent − 20 footer
    parent.destroy();
  });

  it("an explicit-height viewport keeps its height (basis stays auto)", () => {
    // Regression guard for the basis fix: `flex-basis: 0` would override an
    // explicit height per CSS, so it must only apply to the flexGrow case.
    const parent = new PanelNode({ direction: "column", width: 200, height: 200 });
    const sv = new ScrollViewNode({ height: 120 });
    for (let i = 0; i < 8; i++) sv.addElement(new PanelNode({ height: 30 }));
    parent.addElement(sv);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(sv.yogaNode.getComputedHeight()).toBe(120);
    expect(sv.maxScroll).toBe(240 - 120);
    parent.destroy();
  });

  it("respects an explicit flexBasis prop instead of overriding it", () => {
    // _reconcileScrollBasis must not clobber a caller-supplied flexBasis. With
    // basis 60 (and no grow), the viewport's main size resolves to 60, not its
    // content size (240) — proving the explicit prop survived reconciliation.
    const parent = new PanelNode({ direction: "column", width: 200, height: 300 });
    const sv = new ScrollViewNode({ flexBasis: 60 });
    for (let i = 0; i < 8; i++) sv.addElement(new PanelNode({ height: 30 }));
    parent.addElement(sv);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(sv.yogaNode.getComputedHeight()).toBe(60);
    expect(sv.maxScroll).toBe(240 - 60);
    parent.destroy();
  });

  it("survives destroy()", () => {
    const { sv } = buildScrollView(3);
    expect(() => sv.destroy()).not.toThrow();
  });
});
