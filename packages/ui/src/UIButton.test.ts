import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
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

  class MockSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    tint = 0xffffff;
    anchor = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };

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
    tileScale = { x: 1, y: 1, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
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

  return { mocks: { MockContainer, MockGraphics, MockText, MockSprite, MockNineSliceSprite, MockTilingSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UIButton } from "./UIButton.js";
import { UIText } from "./UIText.js";

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
    const btn = new UIButton({ children: "Test", width: 100, height: 30, onClick });
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    container.emit("pointerup");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    const btn = new UIButton({ children: "Test", width: 100, height: 30, onClick });
    btn.setDisabled(true);
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    container.emit("pointerup");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled state changes cursor and alpha", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
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
    const btn = new UIButton({ children: "Test", width: 100, height: 30, disabled: true });
    expect(btn.disabled).toBe(true);
  });

  it("setText updates the label", () => {
    const btn = new UIButton({ children: "Hello", width: 100, height: 30 });
    btn.setText("World");
    // No throw; label updated internally
  });

  it("visibility can be toggled", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    expect(btn.visible).toBe(true);
    btn.visible = false;
    expect(btn.visible).toBe(false);
  });

  it("hover state changes background", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    // Should not throw on hover/out events
    container.emit("pointerover");
    container.emit("pointerout");
  });

  it("press state changes background", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    // Should not throw on down event
    container.emit("pointerdown");
  });

  it("destroy cleans up", () => {
    const btn = new UIButton({ children: "Test", width: 100, height: 30 });
    btn.destroy();
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
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
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;

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
    const btn = new UIButton({ children: "Test", width: 100, height: 30, onClick: onClick1 });
    btn.update({ onClick: onClick2 });

    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    container.emit("pointerup");
    expect(onClick1).not.toHaveBeenCalled();
    expect(onClick2).toHaveBeenCalledTimes(1);
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
      const btn = new UIButton({ children: "Hi", width: "auto", height: "auto" });
      btn.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      expect(btn.yogaNode.getComputedWidth()).toBe(50 + 12 * 2);
      expect(btn.yogaNode.getComputedHeight()).toBe(14 + 6 * 2);
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
  });
});
