import { describe, it, expect, vi, beforeAll } from "vitest";
import { AssetHandle } from "@yagejs/core";
import type { Texture } from "pixi.js";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    destroyed = false;

    addChild(child: MockContainer): MockContainer { this.children.push(child); child.parent = this; return child; }
    addChildAt(child: MockContainer, index: number): MockContainer { this.children.splice(index, 0, child); child.parent = this; return child; }
    removeChild(child: MockContainer): MockContainer { const i = this.children.indexOf(child); if (i !== -1) { this.children.splice(i, 1); child.parent = null; } return child; }
    removeFromParent(): void { this.parent?.removeChild(this); }
    destroy(): void { this.destroyed = true; this.removeFromParent(); }
  }

  class MockGraphics extends MockContainer {
    private _lastFillW = 0;
    private _lastFillH = 0;
    clearCalled = false;
    clear(): MockGraphics { this.clearCalled = true; return this; }
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
    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) { this.texture = opts.texture; this.width = (opts.width as number) ?? 0; this.height = (opts.height as number) ?? 0; }
    }
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

import { BackgroundRenderer } from "./background-renderer.js";
import { setAssetManager } from "./asset-helpers.js";
import { AssetManager } from "@yagejs/core";

const mockTexture = { width: 64, height: 64 };

beforeAll(() => {
  const am = new AssetManager();
  (am as unknown as { cache: Map<string, unknown> }).cache = new Map([["texture:test.png", mockTexture]]);
  setAssetManager(am);
});

describe("BackgroundRenderer", () => {
  it("creates Graphics for color background", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set({ color: 0xff0000 }, parent as never);
    expect(parent.children.length).toBe(1);
    expect(parent.children[0]).toBeInstanceOf(mocks.MockGraphics);
  });

  it("resize draws the color background", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set({ color: 0xff0000 }, parent as never);
    renderer.resize(200, 100);
    const g = parent.children[0] as InstanceType<typeof mocks.MockGraphics>;
    expect(g.lastWidth).toBe(200);
    expect(g.lastHeight).toBe(100);
  });

  it("creates Sprite for stretch texture background", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set({ texture: handle, mode: "stretch" }, parent as never);
    expect(parent.children.length).toBe(1);
    expect(parent.children[0]).toBeInstanceOf(mocks.MockSprite);
  });

  it("creates NineSliceSprite for nine-slice mode", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set({ texture: handle, mode: "nine-slice", nineSlice: 10 }, parent as never);
    expect(parent.children[0]).toBeInstanceOf(mocks.MockNineSliceSprite);
  });

  it("creates TilingSprite for tile mode", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set({ texture: handle, mode: "tile" }, parent as never);
    expect(parent.children[0]).toBeInstanceOf(mocks.MockTilingSprite);
  });

  it("resize updates texture sprite dimensions", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set({ texture: handle, mode: "stretch" }, parent as never);
    renderer.resize(300, 150);
    const sprite = parent.children[0] as InstanceType<typeof mocks.MockSprite>;
    expect(sprite.width).toBe(300);
    expect(sprite.height).toBe(150);
  });

  it("switching from color to texture destroys old and creates new", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set({ color: 0xff0000 }, parent as never);
    const oldChild = parent.children[0]!;

    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set({ texture: handle, mode: "stretch" }, parent as never);
    expect(oldChild.destroyed).toBe(true);
    expect(parent.children.length).toBe(1);
    expect(parent.children[0]).toBeInstanceOf(mocks.MockSprite);
  });

  it("destroy removes the display object", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set({ color: 0xff0000 }, parent as never);
    const child = parent.children[0]!;
    renderer.destroy();
    expect(child.destroyed).toBe(true);
  });
});
