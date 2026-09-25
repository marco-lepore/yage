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
    pivot = { x: 0, y: 0 };
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

    /** This container's position summed up the parent chain. */
    worldPosition(): { x: number; y: number } {
      let x = this.position.x;
      let y = this.position.y;
      let node = this.parent;
      while (node) {
        x += node.position.x;
        y += node.position.y;
        node = node.parent;
      }
      return { x, y };
    }

    /**
     * Position-only stand-in for Pixi's projection: exact here, because this
     * mock carries no scale and no rotation.
     */
    toLocal<P extends { x: number; y: number }>(
      position: { x: number; y: number },
      from?: MockContainer,
      point?: P,
    ): P {
      const out = (point ?? { x: 0, y: 0 }) as P;
      const origin = from?.worldPosition() ?? { x: 0, y: 0 };
      const here = this.worldPosition();
      out.x = position.x + origin.x - here.x;
      out.y = position.y + origin.y - here.y;
      return out;
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
    /** How many times the geometry has been rebuilt. */
    drawCount = 0;
    clear(): MockGraphics {
      this.drawCount++;
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

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    width: number;
    height: number;
    anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      this.width =
        ((opts?.style?.fontSize as number) ?? 14) * this.text.length * 0.5;
      this.height = (opts?.style?.fontSize as number) ?? 14;
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

  return { mocks: { MockContainer, MockGraphics, MockText, MockRectangle } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
  BitmapText: mocks.MockText,
  Rectangle: mocks.MockRectangle,
}));

import Yoga from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UIScrollView } from "./UIScrollView.js";
import { UIPanel } from "./UIPanel.js";
import { UIButton } from "./UIButton.js";
import { UIFocusScope } from "./focus/UIFocusScope.js";

beforeAll(() => {
  setYoga(Yoga);
});

/** Build a ScrollView with `n` fixed-height rows and run a layout pass. */
function buildScrollView(
  rows: number,
  opts: {
    height?: number;
    rowHeight?: number;
    onScroll?: (offset: number) => void;
  } = {},
): { sv: UIScrollView; rowsArr: UIPanel[] } {
  const height = opts.height ?? 100;
  const rowHeight = opts.rowHeight ?? 30;
  const sv = new UIScrollView({
    width: 200,
    height,
    ...(opts.onScroll ? { onScroll: opts.onScroll } : {}),
  });
  const rowsArr: UIPanel[] = [];
  for (let i = 0; i < rows; i++) {
    const row = new UIPanel({ height: rowHeight, width: 200 });
    rowsArr.push(row);
    sv.addElement(row);
  }
  layout(sv);
  return { sv, rowsArr };
}

/**
 * Build a horizontal ScrollView with `n` fixed-width columns in a 100x50
 * viewport, and run a layout pass.
 */
function buildHorizontal(cols: number): {
  sv: UIScrollView;
  colsArr: UIPanel[];
} {
  const sv = new UIScrollView({
    width: 100,
    height: 50,
    direction: "horizontal",
  });
  const colsArr: UIPanel[] = [];
  for (let i = 0; i < cols; i++) {
    const col = new UIPanel({ width: 30, height: 40 });
    colsArr.push(col);
    sv.addElement(col);
  }
  layout(sv);
  return { sv, colsArr };
}

function layout(sv: UIScrollView): void {
  sv.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
  sv.applyLayout();
}

describe("UIScrollView", () => {
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
    const content = (sv as unknown as { content: UIPanel }).content;

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
    const sv = new UIScrollView({ width: 200, height: 100 });
    const a = new UIPanel({ height: 30 });
    const b = new UIPanel({ height: 30 });
    const c = new UIPanel({ height: 30 });
    const d = new UIPanel({ height: 30 });
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

  it("starts panning after 10px and suppresses a child release click", () => {
    const onClick = vi.fn();
    const sv = new UIScrollView({ width: 200, height: 100 });
    const button = new UIButton({ height: 150, onClick });
    sv.addElement(button);
    layout(sv);
    const viewport = sv.displayObject as unknown as InstanceType<
      typeof mocks.MockContainer
    > & { interactiveChildren: boolean };
    const buttonView = button.displayObject as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    viewport.emit("pointerdown", { global: { x: 0, y: 50 } });
    viewport.emit("globalpointermove", { global: { x: 0, y: 42 } });
    expect(sv.scrollOffset).toBe(0);

    viewport.emit("globalpointermove", { global: { x: 0, y: 30 } });
    expect(sv.scrollOffset).toBe(20);
    expect(viewport.interactiveChildren).toBe(false);

    buttonView.emit("pointerup", {});
    expect(onClick).not.toHaveBeenCalled();
    viewport.emit("pointerup", {});
    expect(viewport.interactiveChildren).toBe(true);
  });

  it("fires onScroll only when the offset changes", () => {
    const onScroll = vi.fn();
    const sv = new UIScrollView({ width: 200, height: 100, onScroll });
    for (let i = 0; i < 5; i++) sv.addElement(new UIPanel({ height: 30 }));
    layout(sv);

    sv.scrollTo(20);
    sv.scrollTo(20); // no change → no extra call
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onScroll).toHaveBeenLastCalledWith(20);
  });

  it("update({ direction }) flips the scroll axis and resets the offset", () => {
    const { sv } = buildScrollView(5, { height: 100, rowHeight: 30 });
    const content = (sv as unknown as { content: UIPanel }).content;
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
    const sv = new UIScrollView({ width: 200, height: 100, onScroll });
    for (let i = 0; i < 5; i++) sv.addElement(new UIPanel({ height: 30 }));
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
    const content = (sv as unknown as { content: UIPanel }).content;
    // Default thumb: thickness 4 + margin 2*2 = 8.
    expect(sv.scrollbarGutter).toBe(8);
    expect(content.yogaNode.getComputedWidth()).toBe(192); // 200 - gutter

    const off = new UIScrollView({ width: 200, height: 100, scrollbar: false });
    for (let i = 0; i < 5; i++) off.addElement(new UIPanel({ height: 30 }));
    layout(off);
    const offContent = (off as unknown as { content: UIPanel }).content;
    expect(off.scrollbarGutter).toBe(0);
    expect(offContent.yogaNode.getComputedWidth()).toBe(200);
  });

  it("honors custom scrollbar size and reconfigures on update()", () => {
    const sv = new UIScrollView({
      width: 200,
      height: 100,
      scrollbar: { thickness: 10, margin: 3 },
    });
    for (let i = 0; i < 5; i++) sv.addElement(new UIPanel({ height: 30 }));
    layout(sv);
    const content = (sv as unknown as { content: UIPanel }).content;
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
    const parent = new UIPanel({
      direction: "column",
      width: 200,
      height: 100,
    });
    const sv = new UIScrollView({ flexGrow: 1 });
    for (let i = 0; i < 8; i++) {
      sv.addElement(new UIPanel({ height: 30, width: 200 })); // 240 total
    }
    parent.addElement(sv);
    const footer = new UIPanel({ height: 20 }); // fixed footer sibling
    parent.addElement(footer);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(sv.maxScroll).toBeGreaterThan(0);
    // The fixed footer keeps its 20px and the scroll viewport fills the rest:
    // the viewport's own flexShrink:1 + minHeight:0 let it shrink to the
    // available space, while the footer (default flexShrink:0) is not pulled in.
    expect(footer.yogaNode.getComputedHeight()).toBe(20);
    expect(sv.yogaNode.getComputedHeight()).toBe(80); // 100 parent − 20 footer
    parent.destroy();
  });

  it("sizes to content (does not collapse) when flexGrow in an auto-height parent", () => {
    // Regression for the ui-react menu: a flexGrow ScrollView inside an
    // auto-height (content-sized / maxHeight) parent must size to its content,
    // not collapse to 0. A forced `flex-basis: 0` here would have nothing to
    // grow into and the viewport would vanish.
    const parent = new UIPanel({ direction: "column", width: 200 }); // no height
    const sv = new UIScrollView({ flexGrow: 1 });
    for (let i = 0; i < 4; i++) sv.addElement(new UIPanel({ height: 30 })); // 120
    parent.addElement(sv);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(sv.yogaNode.getComputedHeight()).toBe(120); // sized to content, not 0
    parent.destroy();
  });

  it("an explicit-height viewport keeps its height", () => {
    const parent = new UIPanel({
      direction: "column",
      width: 200,
      height: 200,
    });
    const sv = new UIScrollView({ height: 120 });
    for (let i = 0; i < 8; i++) sv.addElement(new UIPanel({ height: 30 }));
    parent.addElement(sv);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(sv.yogaNode.getComputedHeight()).toBe(120);
    expect(sv.maxScroll).toBe(240 - 120);
    parent.destroy();
  });

  it("respects an explicit flexBasis prop", () => {
    // With basis 60 (and no grow), the viewport's main size resolves to 60, not
    // its content size (240) — the caller's flexBasis is applied verbatim.
    const parent = new UIPanel({
      direction: "column",
      width: 200,
      height: 300,
    });
    const sv = new UIScrollView({ flexBasis: 60 });
    for (let i = 0; i < 8; i++) sv.addElement(new UIPanel({ height: 30 }));
    parent.addElement(sv);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(sv.yogaNode.getComputedHeight()).toBe(60);
    expect(sv.maxScroll).toBe(240 - 60);
    parent.destroy();
  });

  it("fills a fixed-height column via the `flex` shorthand (basis 0 + grow)", () => {
    // `flex: 1` expands to grow:1 / shrink:1 / basis:0, so the viewport grows
    // from a 0 basis into the column's free space and the fixed footer keeps
    // its height — the web `flex: 1` scroll idiom.
    const parent = new UIPanel({
      direction: "column",
      width: 200,
      height: 100,
    });
    const sv = new UIScrollView({ flex: 1 });
    for (let i = 0; i < 8; i++) sv.addElement(new UIPanel({ height: 30 })); // 240
    parent.addElement(sv);
    const footer = new UIPanel({ height: 20 });
    parent.addElement(footer);
    parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    parent.applyLayout();

    expect(footer.yogaNode.getComputedHeight()).toBe(20);
    expect(sv.yogaNode.getComputedHeight()).toBe(80); // 100 − 20 footer
    expect(sv.maxScroll).toBeGreaterThan(0);
    parent.destroy();
  });

  it("reports the clipped box on both axes once a layout pass has run", () => {
    const unlaid = new UIScrollView({ width: 200, height: 100 });
    expect([unlaid.viewportWidth, unlaid.viewportHeight]).toEqual([0, 0]);

    const { sv } = buildScrollView(8, { height: 100 });
    expect([sv.viewportWidth, sv.viewportHeight]).toEqual([200, 100]);

    const horizontal = buildHorizontal(8).sv;
    expect([horizontal.viewportWidth, horizontal.viewportHeight]).toEqual([
      100, 50,
    ]);
  });

  describe("hover callbacks", () => {
    /** The clipped viewport, which is where the hover listeners sit. */
    const viewportOf = (sv: UIScrollView): { emit(e: string): void } =>
      sv.displayObject as unknown as { emit(e: string): void };

    it("fires the three hover callbacks as the pointer crosses the viewport", () => {
      const onPointerOver = vi.fn();
      const onPointerOut = vi.fn();
      const onHover = vi.fn();
      const sv = new UIScrollView({
        width: 200,
        height: 100,
        onPointerOver,
        onPointerOut,
        onHover,
      });

      // An update that names no handler keeps them all.
      sv.update({ width: 260 });
      viewportOf(sv).emit("pointerover");
      viewportOf(sv).emit("pointerout");

      expect(onPointerOver).toHaveBeenCalledTimes(1);
      expect(onPointerOut).toHaveBeenCalledTimes(1);
      expect(onHover.mock.calls).toEqual([[true], [false]]);
      sv.destroy();
    });

    it("swaps a handler an update replaces and drops one it clears", () => {
      const first = vi.fn();
      const second = vi.fn();
      const sv = new UIScrollView({
        width: 200,
        height: 100,
        onPointerOver: first,
      });

      sv.update({ onPointerOver: second });
      viewportOf(sv).emit("pointerover");
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);

      sv.update({ onPointerOver: undefined });
      viewportOf(sv).emit("pointerover");
      expect(second).toHaveBeenCalledTimes(1);
      sv.destroy();
    });
  });

  describe("scrollIntoView", () => {
    // Eight 30 px rows in a 100 px viewport: row 4 spans 120 to 150.
    it.each([
      ["a row below the fold, to the far edge", 0, 4, {}, 50],
      ["a row above the fold, to the near edge", 140, 0, {}, 0],
      ["a fully visible row nowhere", 0, 1, {}, 0],
      ["padding clear of the far edge", 0, 4, { padding: 10 }, 60],
      ["padding clear of the near edge", 140, 4, { padding: 10 }, 110],
      ["align 'start' to the near edge", 0, 4, { align: "start" }, 120],
      ["align 'end' to the far edge", 0, 4, { align: "end" }, 50],
      ["align 'center' to the middle", 0, 4, { align: "center" }, 85],
      ["align 'start' for a visible row", 0, 1, { align: "start" }, 30],
      ["align 'start' clamped at the far end", 0, 7, { align: "start" }, 140],
      ["align 'end' clamped at the near end", 100, 0, { align: "end" }, 0],
    ] as const)("scrolls %s", (_name, from, row, options, expected) => {
      const onScroll = vi.fn();
      const { sv, rowsArr } = buildScrollView(8, { onScroll });
      sv.scrollTo(from);
      onScroll.mockClear();

      sv.scrollIntoView(rowsArr[row]!, options);

      expect(sv.scrollOffset).toBe(expected);
      expect(onScroll).toHaveBeenCalledTimes(expected === from ? 0 : 1);
      sv.destroy();
    });

    it("scrolls along the horizontal axis", () => {
      const { sv, colsArr } = buildHorizontal(8);
      sv.scrollIntoView(colsArr[4]!);
      expect(sv.scrollOffset).toBe(50);
      const content = (sv as unknown as { content: UIPanel }).content;
      expect(content.container.position.x).toBe(-50);
      sv.destroy();
    });

    it("finds a card two panels deep, from any scroll position", () => {
      const sv = new UIScrollView({ width: 200, height: 100 });
      for (let i = 0; i < 4; i++) {
        sv.addElement(new UIPanel({ height: 30, width: 200 }));
      }
      const outer = new UIPanel({ height: 60, width: 200, padding: 10 });
      const inner = outer.panel({ height: 20, width: 100 });
      const card = inner.panel({ height: 20, width: 50 });
      sv.addElement(outer);
      layout(sv);

      // The card sits at 130 in the content: 120 for the four rows above it
      // plus its grandparent's 10px padding.
      sv.scrollIntoView(card);
      expect(sv.scrollOffset).toBe(50);

      // The same card from a scrolled list lands on the same offset, which is
      // what summing Yoga boxes up the chain would get wrong.
      sv.scrollTo(30);
      sv.scrollIntoView(card);
      expect(sv.scrollOffset).toBe(50);
      sv.destroy();
    });

    it("does nothing in a view whose content fits", () => {
      const onScroll = vi.fn();
      const { sv, rowsArr } = buildScrollView(3, { onScroll });
      expect(sv.maxScroll).toBe(0);

      sv.scrollIntoView(rowsArr[2]!, { align: "start" });

      expect(sv.scrollOffset).toBe(0);
      expect(onScroll).not.toHaveBeenCalled();
      sv.destroy();
    });

    it("throws for an element from another tree, naming the view", () => {
      const { sv } = buildScrollView(8);
      const other = buildScrollView(8);
      sv.scrollTo(40);

      expect(() => sv.scrollIntoView(other.rowsArr[3]!)).toThrowError(
        "UIScrollView.scrollIntoView: the element is not inside this scroll " +
          "view.",
      );
      expect(sv.scrollOffset).toBe(40);
      sv.destroy();
      other.sv.destroy();
    });

    it("throws for a padding that is not a length, naming the value", () => {
      const { sv, rowsArr } = buildScrollView(8);
      sv.scrollTo(40);
      const row = rowsArr[7]!;

      expect(() => sv.scrollIntoView(row, { padding: -4 })).toThrowError(
        "UIScrollView.scrollIntoView: padding must be a finite number of " +
          "pixels at or above 0, got -4.",
      );
      expect(() =>
        sv.scrollIntoView(row, { padding: Number.NaN }),
      ).toThrowError(/got NaN\.$/);
      expect(() =>
        sv.scrollIntoView(row, { padding: Number.POSITIVE_INFINITY }),
      ).toThrowError(/got Infinity\.$/);
      expect(sv.scrollOffset).toBe(40);
      sv.destroy();
    });

    it("warns once and stays put when asked before the first layout pass", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const sv = new UIScrollView({ width: 200, height: 100 });
      const row = new UIPanel({ height: 30, width: 200 });
      sv.addElement(row);

      sv.scrollIntoView(row);
      sv.scrollIntoView(row);

      expect(sv.scrollOffset).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("UIScrollView.scrollIntoView");
      warn.mockRestore();
      sv.destroy();
    });
  });

  describe("builders", () => {
    it("adds text, buttons, panels and nested viewports to the content", () => {
      const sv = new UIScrollView({ width: 200, height: 100 });
      const text = sv.text("Row");
      const button = sv.button("Buy", { onClick: () => undefined });
      const panel = sv.panel({ direction: "row" });
      const nested = sv.scrollView({ height: 40 });

      expect(sv.children).toEqual([text, button, panel, nested]);
      sv.destroy();
    });

    it("lays a built row out like one added with addElement", () => {
      const built = new UIScrollView({ width: 200, height: 100 });
      built.panel({ width: 200, height: 30 });
      layout(built);

      const added = new UIScrollView({ width: 200, height: 100 });
      added.addElement(new UIPanel({ width: 200, height: 30 }));
      layout(added);

      expect(built.children[0]?.yogaNode.getComputedHeight()).toBe(
        added.children[0]?.yogaNode.getComputedHeight(),
      );
      built.destroy();
      added.destroy();
    });
  });

  it("survives destroy()", () => {
    const { sv } = buildScrollView(3);
    expect(() => sv.destroy()).not.toThrow();
  });

  describe("redraw gating", () => {
    /** The Graphics the thumb is drawn into. */
    function thumb(sv: UIScrollView): InstanceType<typeof mocks.MockGraphics> {
      const gfx = (
        sv as unknown as {
          scrollbarGfx: InstanceType<typeof mocks.MockGraphics> | undefined;
        }
      ).scrollbarGfx;
      if (!gfx) throw new Error("the scroll view has not drawn a scrollbar");
      return gfx;
    }

    /** The Graphics the clip mask is drawn into. */
    function clipMask(
      sv: UIScrollView,
    ): InstanceType<typeof mocks.MockGraphics> {
      const mask = (sv.displayObject as unknown as MockContainerLike).mask;
      expect(mask).toBeTruthy();
      return mask as InstanceType<typeof mocks.MockGraphics>;
    }

    it("draws nothing again on a layout pass that changed nothing", () => {
      const { sv } = buildScrollView(6);
      const bar = thumb(sv);
      const mask = clipMask(sv);
      const barDraws = bar.drawCount;
      const maskDraws = mask.drawCount;

      layout(sv);
      layout(sv);

      expect(bar.drawCount).toBe(barDraws);
      expect(mask.drawCount).toBe(maskDraws);
      sv.destroy();
    });

    it("redraws the thumb when only the cross-axis size changes", () => {
      // A vertical thumb's fixed edge is `viewportWidth - thickness - margin`,
      // so a width-only resize moves it even though the scroll axis, the
      // offset and the scroll range are all unchanged.
      const { sv } = buildScrollView(6);
      const bar = thumb(sv);
      const before = bar.drawCount;
      const mainBefore = sv.maxScroll;

      sv.update({ width: 260 });
      layout(sv);

      expect(sv.maxScroll).toBe(mainBefore);
      expect(sv.scrollOffset).toBe(0);
      expect(bar.drawCount).toBe(before + 1);
      sv.destroy();
    });

    it("redraws the thumb after a scrollbar style change at an unchanged size", () => {
      const { sv } = buildScrollView(6);
      const bar = thumb(sv);
      const before = bar.drawCount;

      sv.update({ scrollbar: { thickness: 12, color: 0x00ff00 } });
      layout(sv);

      expect(bar.drawCount).toBe(before + 1);
      sv.destroy();
    });

    it("redraws the thumb when the scroll offset moves", () => {
      const { sv } = buildScrollView(6);
      const bar = thumb(sv);
      const before = bar.drawCount;

      sv.scrollTo(40);
      layout(sv);

      expect(bar.drawCount).toBe(before + 1);
      sv.destroy();
    });

    it("redraws the clip mask when the viewport size changes", () => {
      const { sv } = buildScrollView(6);
      const mask = clipMask(sv);
      const before = mask.drawCount;

      sv.update({ width: 260 });
      layout(sv);

      expect(mask.drawCount).toBe(before + 1);
      sv.destroy();
    });
  });
});

/** What the pixi mock exposes for a container carrying a mask. */
interface MockContainerLike {
  mask: unknown;
}

// The focus props every widget shares are covered in focus-props.test.ts.
describe("UIScrollView focus", () => {
  it("is a candidate a scope still walks into", () => {
    const host = new UIPanel({ width: 200, height: 100 });
    const sv = new UIScrollView({ width: 200, height: 100, focusable: true });
    const row = new UIButton({ children: "Slot 1", width: 200, height: 30 });
    sv.addElement(row);
    host.addElement(sv);
    host.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    host.applyLayout();
    const scope = new UIFocusScope(
      { displayObject: host.container, roots: () => host.children },
      {},
    );

    // The view takes focus itself, and the walk carries on into its rows.
    expect(scope.candidates).toEqual([sv, row]);

    scope._destroy();
    host.destroy();
  });
});
