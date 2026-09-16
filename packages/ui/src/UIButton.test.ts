import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

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

    removeFromParent(): void {
      this.parent?.removeChild(this);
    }

    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      const listeners = this._listeners.get(event);
      if (listeners) {
        for (const fn of listeners) fn(...args);
      }
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
    /** The style passed to the most recent `fill`. */
    lastFill: { color?: number; alpha?: number } | undefined;
    fill(style?: { color?: number; alpha?: number }): MockGraphics {
      this.lastFill = style;
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
      this.width = 50;
      this.height = 14;
    }
  }

  // Distinct subclass so tests can assert a bitmap label was constructed.
  class MockBitmapText extends MockText {}

  class MockSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    tint = 0xffffff;
    anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

    constructor(texture?: unknown) {
      super();
      this.texture = texture;
    }
  }

  class MockNineSliceSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    leftWidth = 0;
    topHeight = 0;
    rightWidth = 0;
    bottomHeight = 0;

    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) {
        this.texture = opts.texture;
        this.leftWidth = (opts.leftWidth as number) ?? 0;
        this.topHeight = (opts.topHeight as number) ?? 0;
        this.rightWidth = (opts.rightWidth as number) ?? 0;
        this.bottomHeight = (opts.bottomHeight as number) ?? 0;
      }
    }
  }

  class MockTilingSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    tileScale = {
      x: 1,
      y: 1,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    tilePosition = { x: 0, y: 0 };

    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) {
        this.texture = opts.texture;
        this.width = (opts.width as number) ?? 0;
        this.height = (opts.height as number) ?? 0;
      }
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

  return {
    mocks: {
      MockContainer,
      MockGraphics,
      MockText,
      MockBitmapText,
      MockSprite,
      MockNineSliceSprite,
      MockTilingSprite,
      MockRectangle,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
  BitmapText: mocks.MockBitmapText,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
  Rectangle: mocks.MockRectangle,
}));

import Yoga, { Direction, Edge } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UIButton } from "./UIButton.js";
import { UIText } from "./UIText.js";
import { UIPanel } from "./UIPanel.js";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { bindUIErrorBoundary } from "./error-boundary.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("UIButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a button with text and dimensions", () => {
    const btn = new UIButton({ children: "Click Me", width: 200, height: 40 });
    expect(btn.displayObject).toBeDefined();
    expect(btn.visible).toBe(true);
    expect(btn.yogaNode.getComputedWidth()).toBeNaN(); // Not laid out yet
  });

  it("fires onClick when pointer up", () => {
    const onClick = vi.fn();
    const btn = new UIButton({
      children: "Test",
      width: 100,
      height: 30,
      onClick,
    });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    container.emit("pointerdown");
    container.emit("pointerup");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    const btn = new UIButton({
      children: "Test",
      width: 100,
      height: 30,
      onClick,
    });
    btn.setDisabled(true);
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    container.emit("pointerdown");
    container.emit("pointerup");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled state changes cursor and alpha", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(container.cursor).toBe("pointer");
    expect(container.alpha).toBe(1);

    btn.setDisabled(true);
    expect(container.cursor).toBe("default");
    expect(container.alpha).toBe(0.5);
    expect(btn.disabled).toBe(true);

    btn.setDisabled(false);
    expect(container.cursor).toBe("pointer");
    expect(container.alpha).toBe(1);
    expect(btn.disabled).toBe(false);
  });

  it("disabled via constructor option", () => {
    const btn = new UIButton({
      children: "Test",
      width: 100,
      height: 30,
      disabled: true,
    });
    expect(btn.disabled).toBe(true);
  });

  it("setText updates the label", () => {
    const btn = new UIButton({ children: "Hello", width: 100, height: 30 });
    btn.setText("World");
    // No throw; label updated internally
  });

  it("forwards bitmap to the auto-wrapped label", () => {
    const btn = new UIButton({
      children: "PLAY",
      bitmap: true,
      textStyle: { fill: 0xffcc00, fontFamily: "PressStart", fontSize: 8 },
    });
    const label = btn.children[0] as UIText;
    const text = label.displayObject as unknown as InstanceType<
      typeof mocks.MockBitmapText
    > & { style: Record<string, unknown> };
    expect(text).toBeInstanceOf(mocks.MockBitmapText);
    expect(text.style).toMatchObject({
      fill: 0xffcc00,
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("forwards bitmap to a label created later via setText", () => {
    const btn = new UIButton({ bitmap: true });
    btn.setText("SCORE");
    const label = btn.children[0] as UIText;
    expect(label.displayObject).toBeInstanceOf(mocks.MockBitmapText);
  });

  it("update({ bitmap, children }) promotes to a BitmapText label", () => {
    // No children at construction → no label yet. A reconciler pass that
    // brings both bitmap and the string must build the label as BitmapText,
    // not stale canvas Text.
    const btn = new UIButton({});
    btn.update({ bitmap: true, children: "SCORE" });
    const label = btn.children[0] as UIText;
    expect(label.displayObject).toBeInstanceOf(mocks.MockBitmapText);
  });

  it("update({ textStyle }) before children promotes the label with that style", () => {
    // Two-step reconcile: textStyle arrives before the label exists, then the
    // string. The promoted label must carry the textStyle, not the stale
    // construction-time value.
    const btn = new UIButton({});
    btn.update({ textStyle: { fill: 0xff0000 } });
    btn.update({ children: "SCORE" });
    const label = btn.children[0] as UIText;
    const text = label.displayObject as unknown as {
      style: Record<string, unknown>;
    };
    expect(text.style).toMatchObject({ fill: 0xff0000 });
  });

  it("warns (and keeps the class) when update() changes bitmap on an existing label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const btn = new UIButton({ children: "SCORE" }); // canvas label
    const label = btn.children[0] as UIText;
    expect(label.displayObject).not.toBeInstanceOf(mocks.MockBitmapText);

    btn.update({ bitmap: true });

    expect(label.displayObject).not.toBeInstanceOf(mocks.MockBitmapText);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("construction-only"),
    );
    warn.mockRestore();
  });

  it("does not warn when update() repeats bitmap: false on a canvas label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const btn = new UIButton({ children: "SCORE" });
    btn.update({ bitmap: false });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  describe("state backgrounds", () => {
    /** The hover and press backgrounds the button resolved for itself. */
    function stateBgs(btn: UIButton): {
      hover: Record<string, unknown>;
      press: Record<string, unknown>;
    } {
      const inner = btn as unknown as {
        hoverBgOpts: Record<string, unknown>;
        pressBgOpts: Record<string, unknown>;
      };
      return { hover: inner.hoverBgOpts, press: inner.pressBgOpts };
    }

    it("keeps the grey triple a button with no background used to get", () => {
      const { hover, press } = stateBgs(new UIButton({ children: "Test" }));
      expect(hover).toEqual({ color: 0x555555, alpha: 1, radius: 4 });
      expect(press).toEqual({ color: 0x333333, alpha: 1, radius: 4 });
    });

    it("derives both states from the colour it was given", () => {
      const btn = new UIButton({
        children: "Test",
        background: { color: 0x204060, radius: 8 },
      });
      const { hover, press } = stateBgs(btn);
      // Each channel scaled and rounded: 0x20 -> 0x28, 0x40 -> 0x50,
      // 0x60 -> 0x78 on hover; 0x18 / 0x30 / 0x48 on press.
      expect(hover.color).toBe(0x285078);
      expect(press.color).toBe(0x183048);
      expect(hover.radius).toBe(8);
      expect(press.radius).toBe(8);
    });

    it("keeps a texture background through both states", () => {
      // A raw texture object, not an asset key: the key path would look the
      // texture up in a loader this test has no business starting.
      const texture = { width: 64, height: 64 } as never;
      const btn = new UIButton({
        children: "Test",
        background: { texture, mode: "nine-slice", nineSlice: 6 },
      });
      const { hover, press } = stateBgs(btn);
      expect(hover.texture).toBe(texture);
      expect(press.texture).toBe(texture);
      // White cannot brighten, so hover leaves the art alone; press darkens.
      expect(hover.tint).toBe(0xffffff);
      expect(press.tint).toBe(0xbfbfbf);
    });

    it("clamps a channel that would brighten past full", () => {
      const btn = new UIButton({
        children: "Test",
        background: { color: 0xf00000 },
      });
      expect(stateBgs(btn).hover.color).toBe(0xff0000);
    });

    it("lets an explicit hover background win, over the derived radius", () => {
      const btn = new UIButton({
        children: "Test",
        background: { color: 0x204060, radius: 8 },
        hoverBackground: { color: 0xff0000 },
      });
      const { hover, press } = stateBgs(btn);
      expect(hover.color).toBe(0xff0000);
      expect(hover.radius).toBe(8);
      expect(press.color).toBe(0x183048);
    });

    it("re-derives both states when the resting background changes", () => {
      const btn = new UIButton({ children: "Test" });
      btn.update({ background: { color: 0x204060, radius: 8 } });
      const { hover, press } = stateBgs(btn);
      expect(hover.color).toBe(0x285078);
      expect(press.color).toBe(0x183048);
    });

    /** The colour the background Graphics was last filled with. */
    function paintedColor(btn: UIButton): number | undefined {
      const container = btn.container as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      const g = container.children[0] as InstanceType<
        typeof mocks.MockGraphics
      >;
      return g.lastFill?.color;
    }

    /** Give the background renderer a computed size to draw at. */
    function layout(btn: UIButton): void {
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      btn.applyLayout();
    }

    it("paints the background the update that disables it supplies", () => {
      const btn = new UIButton({
        children: "Test",
        width: 100,
        height: 30,
        background: { color: 0x204060 },
      });
      layout(btn);

      btn.update({ disabled: true, background: { color: 0x991111 } });

      expect(paintedColor(btn)).toBe(0x991111);
      const container = btn.container as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      expect(container.alpha).toBe(0.5);
      expect(container.eventMode).toBe("none");
    });

    it("paints a background change that reaches a disabled button", () => {
      const btn = new UIButton({
        children: "Test",
        width: 100,
        height: 30,
        background: { color: 0x204060 },
        disabled: true,
      });
      layout(btn);

      btn.update({ background: { color: 0x991111 } });

      expect(paintedColor(btn)).toBe(0x991111);
    });

    it("resets to the button's own default when the background is dropped", () => {
      // A present-but-undefined key means "reset this prop to its default",
      // and a button's default is the grey fill that keeps it visible.
      const btn = new UIButton({
        children: "Test",
        background: { color: 0x204060 },
      });
      btn.update({ background: undefined });
      const resting = (btn as unknown as { bgOpts: Record<string, unknown> })
        .bgOpts;
      expect(resting).toEqual({ color: 0x444444, alpha: 1, radius: 4 });
      expect(stateBgs(btn).hover.color).toBe(0x555555);
    });
  });

  describe("flex-container props", () => {
    function layout(btn: UIButton): void {
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      btn.applyLayout();
    }

    it("lays children out in a row when asked", () => {
      const btn = new UIButton({ direction: "row", gap: 8 });
      const a = new UIPanel({ width: 16, height: 16 });
      const b = new UIPanel({ width: 16, height: 16 });
      btn.addElement(a);
      btn.addElement(b);
      layout(btn);

      expect(a.yogaNode.getComputedTop()).toBe(b.yogaNode.getComputedTop());
      expect(b.yogaNode.getComputedLeft() - a.yogaNode.getComputedLeft()).toBe(
        24,
      ); // 16 wide + 8 gap
    });

    it("stacks children in a column by default", () => {
      const btn = new UIButton({});
      const a = new UIPanel({ width: 16, height: 16 });
      const b = new UIPanel({ width: 16, height: 16 });
      btn.addElement(a);
      btn.addElement(b);
      layout(btn);

      expect(a.yogaNode.getComputedLeft()).toBe(b.yogaNode.getComputedLeft());
      expect(b.yogaNode.getComputedTop() - a.yogaNode.getComputedTop()).toBe(
        16,
      );
    });

    it("replaces the default padding with the caller's", () => {
      const btn = new UIButton({ children: "Test", padding: 20 });
      layout(btn);
      expect(btn.yogaNode.getComputedPadding(Edge.Left)).toBe(20);
      expect(btn.yogaNode.getComputedPadding(Edge.Top)).toBe(20);
    });

    it("restores the default padding when the caller drops theirs", () => {
      const btn = new UIButton({ children: "Test", padding: 20 });
      btn.update({ padding: undefined });
      layout(btn);
      expect(btn.yogaNode.getComputedPadding(Edge.Left)).toBe(12);
      expect(btn.yogaNode.getComputedPadding(Edge.Top)).toBe(6);
    });

    it("keeps the caller's padding on a button with both axes pinned", () => {
      // The default padding is skipped for a fully pinned button; an explicit
      // one is not.
      const btn = new UIButton({
        children: "Test",
        width: 120,
        height: 40,
        padding: 4,
      });
      layout(btn);
      expect(btn.yogaNode.getComputedPadding(Edge.Left)).toBe(4);
    });

    it("centres children on both axes unless told otherwise", () => {
      const btn = new UIButton({ width: 100, height: 40 });
      const child = new UIPanel({ width: 20, height: 10 });
      btn.addElement(child);
      layout(btn);
      expect(child.yogaNode.getComputedLeft()).toBe(40); // (100 - 20) / 2
      expect(child.yogaNode.getComputedTop()).toBe(15); // (40 - 10) / 2

      const left = new UIButton({
        width: 100,
        height: 40,
        alignItems: "flex-start",
        justifyContent: "flex-start",
      });
      const leftChild = new UIPanel({ width: 20, height: 10 });
      left.addElement(leftChild);
      layout(left);
      expect(leftChild.yogaNode.getComputedLeft()).toBe(0);
      expect(leftChild.yogaNode.getComputedTop()).toBe(0);
    });
  });

  it("visibility can be toggled", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    expect(btn.visible).toBe(true);
    btn.visible = false;
    expect(btn.visible).toBe(false);
  });

  it("hover state changes background", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    // Should not throw on hover/out events
    container.emit("pointerover");
    container.emit("pointerout");
  });

  it("press state changes background", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    // Should not throw on down event
    container.emit("pointerdown");
  });

  it("destroy cleans up", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    btn.destroy();
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(container.destroyed).toBe(true);
  });

  it("update() preserves hover state", () => {
    const btn = new UIButton({
      children: "Test",
      width: 100,
      height: 30,
      background: { color: 0x444444 },
      hoverBackground: { color: 0xff0000 },
    });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    // Simulate hover
    container.emit("pointerover");

    // Spy on bgRenderer.set via the container's first child (the bg graphics)
    const applyBgSpy = vi.spyOn(btn as never, "applyBg" as never);

    // Re-render with same background prop (simulates sibling re-render)
    btn.update({ background: { color: 0x444444 } });

    // applyCurrentBg should have been called, which should apply hoverBgOpts, not bgOpts
    expect(applyBgSpy).toHaveBeenCalledTimes(1);
    // The argument should be the hover background (merged with defaults)
    const appliedBg = applyBgSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(appliedBg).toHaveProperty("color", 0xff0000);
  });

  it("update() changes onClick handler", () => {
    const onClick1 = vi.fn();
    const onClick2 = vi.fn();
    const btn = new UIButton({
      children: "Test",
      width: 100,
      height: 30,
      onClick: onClick1,
    });
    btn.update({ onClick: onClick2 });

    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    container.emit("pointerdown");
    container.emit("pointerup");
    expect(onClick1).not.toHaveBeenCalled();
    expect(onClick2).toHaveBeenCalledTimes(1);
  });

  it("does not click when the press started outside the button", () => {
    const onClick = vi.fn();
    const btn = new UIButton({ onClick });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    container.emit("pointerup");

    expect(onClick).not.toHaveBeenCalled();
  });

  it("attributes a throwing onClick callback", () => {
    const boundary = new ErrorBoundary(new Logger({ level: LogLevel.None }));
    const error = new Error("click failed");
    const btn = new UIButton({
      onClick: () => {
        throw error;
      },
    });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    bindUIErrorBoundary(btn.container, boundary);

    container.emit("pointerdown");
    expect(() => container.emit("pointerup")).toThrow(error);
    expect(boundary.getCallbackErrors()).toEqual([
      { kind: "UI onClick", error: "click failed" },
    ]);
  });

  it("fires hover callbacks on pointerover/pointerout", () => {
    const onHover = vi.fn();
    const onPointerOver = vi.fn();
    const btn = new UIButton({ children: "Hi", onHover, onPointerOver });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    container.emit("pointerover");
    container.emit("pointerout");

    expect(onPointerOver).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls).toEqual([[true], [false]]);
  });

  it("does not fire hover callbacks while disabled", () => {
    const onHover = vi.fn();
    const btn = new UIButton({ children: "Hi", onHover });
    btn.setDisabled(true);
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    container.emit("pointerover");
    expect(onHover).not.toHaveBeenCalled();
  });

  it("update() swaps the hover handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const btn = new UIButton({ children: "Hi", onHover: first });
    btn.update({ onHover: second });
    const container = btn.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    container.emit("pointerover");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(true);
  });

  describe("auto-size", () => {
    it("shrinks to its string content when width and height are omitted", () => {
      const btn = new UIButton({ children: "Hello" });
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);

      // MockText reports width=50, height=14. Defaults add 12px horizontal
      // and 6px vertical padding on each side around the label.
      expect(btn.yogaNode.getComputedWidth()).toBe(50 + 12 * 2);
      expect(btn.yogaNode.getComputedHeight()).toBe(14 + 6 * 2);
    });

    it("respects explicit width and height when provided", () => {
      const btn = new UIButton({ children: "Hello", width: 200, height: 50 });
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      expect(btn.yogaNode.getComputedWidth()).toBe(200);
      expect(btn.yogaNode.getComputedHeight()).toBe(50);
    });

    it("treats width: 'auto' the same as omitted (shrink-to-content)", () => {
      const btn = new UIButton({
        children: "Hi",
        width: "auto",
        height: "auto",
      });
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      expect(btn.yogaNode.getComputedWidth()).toBe(50 + 12 * 2);
      expect(btn.yogaNode.getComputedHeight()).toBe(14 + 6 * 2);
    });

    it("treats percent dimensions as explicit (no default padding)", () => {
      // `width: "100%"` is concrete enough that the caller owns the box —
      // surprise padding inside a 100%-stretch button would shrink the
      // content area, which is the same footgun explicit pixels avoid.
      const parent = new UIPanel({
        direction: "column",
        width: 200,
        height: 60,
      });
      const btn = new UIButton({
        children: "Hi",
        width: "100%",
        height: "100%",
      });
      parent.addElement(btn);

      parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      parent.applyLayout();

      expect(btn.yogaNode.getComputedWidth()).toBe(200);
      expect(btn.yogaNode.getComputedHeight()).toBe(60);
      // MockText 50×14 centered in 200×60 → (200-50)/2 = 75, (60-14)/2 = 23.
      expect(btn.children[0]!.displayObject.position.x).toBe(75);
      expect(btn.children[0]!.displayObject.position.y).toBe(23);
    });

    it("clears default padding when update() promotes to explicit dimensions", () => {
      const btn = new UIButton({ children: "Hello" });
      btn.update({ width: 200, height: 50 });
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      btn.applyLayout();
      expect(btn.yogaNode.getComputedWidth()).toBe(200);
      expect(btn.yogaNode.getComputedHeight()).toBe(50);
      // With padding cleared, the centered label resolves against the
      // full outer box: MockText is 50×14, so x = (200-50)/2 = 75,
      // y = (50-14)/2 = 18.
      const children = btn.children;
      expect(children[0]!.displayObject.position.x).toBe(75);
      expect(children[0]!.displayObject.position.y).toBe(18);
    });

    it("re-applies default padding when update() demotes back to auto", () => {
      const btn = new UIButton({ children: "Hi", width: 200, height: 50 });
      btn.update({ width: "auto", height: "auto" });
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      expect(btn.yogaNode.getComputedWidth()).toBe(50 + 12 * 2);
      expect(btn.yogaNode.getComputedHeight()).toBe(14 + 6 * 2);
    });
  });

  describe("label truncate", () => {
    const truncateOf = (t: UIText): string | undefined =>
      (t as unknown as { _truncate?: "clip" | "ellipsis" })._truncate;

    it("forwards the truncate option to the auto-created label", () => {
      const btn = new UIButton({
        children: "A label too long for the box",
        truncate: "ellipsis",
      });
      expect(truncateOf(btn.children[0] as UIText)).toBe("ellipsis");
    });

    it("update() propagates a truncate change to the label", () => {
      const btn = new UIButton({ children: "A label" });
      const label = btn.children[0] as UIText;
      expect(truncateOf(label)).toBeUndefined();

      btn.update({ truncate: "clip" });
      expect(truncateOf(label)).toBe("clip");

      btn.update({ truncate: undefined });
      expect(truncateOf(label)).toBeUndefined();
    });

    it("threads truncate through a label promoted via setText()", () => {
      const btn = new UIButton({ truncate: "ellipsis" });
      btn.setText("Promoted label");
      expect(truncateOf(btn.children[0] as UIText)).toBe("ellipsis");
    });
  });

  describe("container mode", () => {
    it("can host multiple UIElement children via addElement", () => {
      // Mirrors what the React reconciler does when <Button> receives
      // ReactNode children (e.g. <Text> + <Image>): each is added as a
      // Yoga child of the button container.
      const btn = new UIButton({});
      const a = new UIText({ children: "Label" });
      const b = new UIText({ children: "Icon" });
      btn.addElement(a);
      btn.addElement(b);

      expect(btn.children).toHaveLength(2);
      expect(btn.children).toContain(a);
      expect(btn.children).toContain(b);
      expect(btn.yogaNode.getChildCount()).toBe(2);
    });

    it("removeElement detaches a child from both trees", () => {
      const btn = new UIButton({});
      const a = new UIText({ children: "Label" });
      btn.addElement(a);
      btn.removeElement(a);

      expect(btn.children).not.toContain(a);
      expect(btn.yogaNode.getChildCount()).toBe(0);
    });

    it("setText promotes a button with no label by adding a UIText child", () => {
      const btn = new UIButton({});
      expect(btn.children).toHaveLength(0);
      btn.setText("Now Labeled");
      expect(btn.children).toHaveLength(1);
    });

    it("insertElementBefore reorders an already-mounted child without duplicating it", () => {
      const btn = new UIButton({});
      const a = new UIText({ children: "A" });
      const b = new UIText({ children: "B" });
      btn.addElement(a);
      btn.addElement(b);

      // Move `b` ahead of `a` — should rearrange in place, not duplicate.
      btn.insertElementBefore(b, a);

      expect(btn.children).toHaveLength(2);
      expect(btn.children[0]).toBe(b);
      expect(btn.children[1]).toBe(a);
      expect(btn.yogaNode.getChildCount()).toBe(2);
    });

    it("rejects a child that still belongs to another container", () => {
      const panel = new UIPanel({});
      const btn = new UIButton({});
      const child = new UIText({ children: "A" });
      panel.addElement(child);

      expect(() => btn.addElement(child)).toThrow(
        "UIButton.addElement: the element is already a child of another container; remove it there first.",
      );
      expect(panel.children).toEqual([child]);
      expect(btn.children).toHaveLength(0);
    });
  });
});
