import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    destroyed = false;
    eventMode = "auto";

    addChild(child: MockContainer): MockContainer { this.children.push(child); child.parent = this; return child; }
    addChildAt(child: MockContainer, index: number): MockContainer { this.children.splice(index, 0, child); child.parent = this; return child; }
    removeChild(child: MockContainer): MockContainer { const i = this.children.indexOf(child); if (i !== -1) { this.children.splice(i, 1); child.parent = null; } return child; }
    removeFromParent(): void { this.parent?.removeChild(this); }
    destroy(): void { this.destroyed = true; this.removeFromParent(); }
  }

  class MockGraphics extends MockContainer {
    private _lastFillW = 0;
    private _lastFillH = 0;
    clear(): MockGraphics { return this; }
    rect(_x: number, _y: number, w: number, h: number): MockGraphics { this._lastFillW = w; this._lastFillH = h; return this; }
    roundRect(_x: number, _y: number, w: number, h: number): MockGraphics { this._lastFillW = w; this._lastFillH = h; return this; }
    fill(): MockGraphics { return this; }
    get lastWidth() { return this._lastFillW; }
    get lastHeight() { return this._lastFillH; }
  }

  class MockSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    constructor(texture?: unknown) { super(); this.texture = texture; }
  }

  class MockNineSliceSprite extends MockContainer {
    texture: unknown; width = 0; height = 0;
    constructor(opts?: Record<string, unknown>) { super(); if (opts) this.texture = opts.texture; }
  }

  class MockTilingSprite extends MockContainer {
    texture: unknown; width = 0; height = 0;
    tileScale = { x: 1, y: 1, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    constructor(opts?: Record<string, unknown>) { super(); if (opts) { this.texture = opts.texture; } }
  }

  return { mocks: { MockContainer, MockGraphics, MockSprite, MockNineSliceSprite, MockTilingSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UIProgressBar } from "./UIProgressBar.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("UIProgressBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates with default backgrounds", () => {
    const bar = new UIProgressBar({ value: 0.5, width: 200, height: 20 });
    expect(bar.displayObject).toBeDefined();
    expect(bar.visible).toBe(true);
    // Should have 2 children (track + fill)
    const container = bar.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.children.length).toBe(2);
  });

  it("clamps value between 0 and 1", () => {
    const bar = new UIProgressBar({ value: 1.5, width: 200, height: 20 });
    bar.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    bar.applyLayout();
    // Fill should not exceed track width
    const fill = (bar.container as unknown as InstanceType<typeof mocks.MockContainer>).children[1] as unknown as InstanceType<typeof mocks.MockGraphics>;
    expect(fill.lastWidth).toBe(200); // clamped to 1.0 * 200
  });

  it("clamps negative value to 0", () => {
    const bar = new UIProgressBar({ value: -0.5, width: 200, height: 20 });
    bar.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    bar.applyLayout();
    const fill = (bar.container as unknown as InstanceType<typeof mocks.MockContainer>).children[1] as unknown as InstanceType<typeof mocks.MockGraphics>;
    expect(fill.lastWidth).toBe(0);
  });

  it("applyLayout sizes fill proportionally to value (horizontal)", () => {
    const bar = new UIProgressBar({ value: 0.5, width: 200, height: 20 });
    bar.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    bar.applyLayout();

    const track = (bar.container as unknown as InstanceType<typeof mocks.MockContainer>).children[0] as unknown as InstanceType<typeof mocks.MockGraphics>;
    const fill = (bar.container as unknown as InstanceType<typeof mocks.MockContainer>).children[1] as unknown as InstanceType<typeof mocks.MockGraphics>;
    expect(track.lastWidth).toBe(200);
    expect(track.lastHeight).toBe(20);
    expect(fill.lastWidth).toBe(100); // 0.5 * 200
    expect(fill.lastHeight).toBe(20);
  });

  it("vertical direction sizes fill height proportionally", () => {
    const bar = new UIProgressBar({ value: 0.75, width: 20, height: 200, direction: "vertical" });
    bar.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    bar.applyLayout();

    const fill = (bar.container as unknown as InstanceType<typeof mocks.MockContainer>).children[1] as unknown as InstanceType<typeof mocks.MockGraphics>;
    expect(fill.lastWidth).toBe(20);
    expect(fill.lastHeight).toBe(150); // 0.75 * 200
  });

  it("update changes value and resizes fill", () => {
    const bar = new UIProgressBar({ value: 0.5, width: 200, height: 20 });
    bar.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    bar.applyLayout();

    bar.update({ value: 0.25 });
    const fill = (bar.container as unknown as InstanceType<typeof mocks.MockContainer>).children[1] as unknown as InstanceType<typeof mocks.MockGraphics>;
    expect(fill.lastWidth).toBe(50); // 0.25 * 200
  });

  it("visibility can be toggled", () => {
    const bar = new UIProgressBar({ value: 0.5, width: 100, height: 10 });
    bar.visible = false;
    expect(bar.visible).toBe(false);
    bar.visible = true;
    expect(bar.visible).toBe(true);
  });

  it("destroy cleans up", () => {
    const bar = new UIProgressBar({ value: 0.5, width: 100, height: 10 });
    bar.destroy();
    const container = bar.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.destroyed).toBe(true);
  });
});
