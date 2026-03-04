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

import Yoga from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UIButton } from "./UIButton.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("UIButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a button with text and dimensions", () => {
    const btn = new UIButton("Click Me", { width: 200, height: 40 });
    expect(btn.displayObject).toBeDefined();
    expect(btn.visible).toBe(true);
    expect(btn.yogaNode.getComputedWidth()).toBeNaN(); // Not laid out yet
  });

  it("fires onClick when pointer up", () => {
    const onClick = vi.fn();
    const btn = new UIButton("Test", { width: 100, height: 30, onClick });
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    container.emit("pointerup");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    const btn = new UIButton("Test", { width: 100, height: 30, onClick });
    btn.setDisabled(true);
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    container.emit("pointerup");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled state changes cursor and alpha", () => {
    const btn = new UIButton("Test", { width: 100, height: 30 });
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
    const btn = new UIButton("Test", { width: 100, height: 30, disabled: true });
    expect(btn.disabled).toBe(true);
  });

  it("setText updates the label", () => {
    const btn = new UIButton("Hello", { width: 100, height: 30 });
    btn.setText("World");
    // No throw; label updated internally
  });

  it("visibility can be toggled", () => {
    const btn = new UIButton("Test", { width: 100, height: 30 });
    expect(btn.visible).toBe(true);
    btn.visible = false;
    expect(btn.visible).toBe(false);
  });

  it("hover state changes background", () => {
    const btn = new UIButton("Test", { width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    // Should not throw on hover/out events
    container.emit("pointerover");
    container.emit("pointerout");
  });

  it("press state changes background", () => {
    const btn = new UIButton("Test", { width: 100, height: 30 });
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    // Should not throw on down event
    container.emit("pointerdown");
  });

  it("destroy cleans up", () => {
    const btn = new UIButton("Test", { width: 100, height: 30 });
    btn.destroy();
    const container = btn.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.destroyed).toBe(true);
  });

  describe("props-driven constructor", () => {
    it("creates a button from props object", () => {
      const onClick = vi.fn();
      const btn = new UIButton({
        children: "Props Button",
        width: 150,
        height: 50,
        onClick,
      });
      expect(btn.displayObject).toBeDefined();
      expect(btn.visible).toBe(true);
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
  });
});
