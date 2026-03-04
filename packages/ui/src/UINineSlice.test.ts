import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { AssetHandle } from "@yage/core";
import type { Texture } from "pixi.js";

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
    clear(): MockGraphics { return this; }
    rect(): MockGraphics { return this; }
    roundRect(): MockGraphics { return this; }
    fill(): MockGraphics { return this; }
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
import { setAssetManager } from "./asset-helpers.js";
import { UINineSlice } from "./UINineSlice.js";
import { AssetManager } from "@yage/core";

const mockTexture = { width: 64, height: 64 };

beforeAll(() => {
  setYoga(Yoga);
  const am = new AssetManager();
  (am as unknown as { cache: Map<string, unknown> }).cache = new Map([["texture:panel.png", mockTexture]]);
  setAssetManager(am);
});

describe("UINineSlice", () => {
  const handle = new AssetHandle<Texture>("texture", "panel.png");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates with uniform insets", () => {
    const ns = new UINineSlice({ texture: handle, insets: 10, width: 100, height: 50 });
    expect(ns.displayObject).toBeDefined();
    const sprite = ns.container as unknown as InstanceType<typeof mocks.MockNineSliceSprite>;
    expect(sprite.leftWidth).toBe(10);
    expect(sprite.topHeight).toBe(10);
    expect(sprite.rightWidth).toBe(10);
    expect(sprite.bottomHeight).toBe(10);
  });

  it("creates with per-edge insets", () => {
    const ns = new UINineSlice({
      texture: handle,
      insets: { left: 5, top: 10, right: 15, bottom: 20 },
      width: 100,
      height: 50,
    });
    const sprite = ns.container as unknown as InstanceType<typeof mocks.MockNineSliceSprite>;
    expect(sprite.leftWidth).toBe(5);
    expect(sprite.topHeight).toBe(10);
    expect(sprite.rightWidth).toBe(15);
    expect(sprite.bottomHeight).toBe(20);
  });

  it("applyLayout sets width and height", () => {
    const ns = new UINineSlice({ texture: handle, insets: 8, width: 200, height: 100 });
    ns.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    ns.applyLayout();
    const sprite = ns.container as unknown as InstanceType<typeof mocks.MockNineSliceSprite>;
    expect(sprite.width).toBe(200);
    expect(sprite.height).toBe(100);
  });

  it("applies tint and alpha", () => {
    const ns = new UINineSlice({ texture: handle, insets: 4, tint: 0xff0000, alpha: 0.5 });
    const sprite = ns.container as unknown as InstanceType<typeof mocks.MockNineSliceSprite>;
    expect(sprite.alpha).toBe(0.5);
  });

  it("visibility can be toggled", () => {
    const ns = new UINineSlice({ texture: handle, insets: 4 });
    ns.visible = false;
    expect(ns.visible).toBe(false);
    ns.visible = true;
    expect(ns.visible).toBe(true);
  });

  it("destroy cleans up", () => {
    const ns = new UINineSlice({ texture: handle, insets: 4 });
    ns.destroy();
    const sprite = ns.container as unknown as InstanceType<typeof mocks.MockNineSliceSprite>;
    expect(sprite.destroyed).toBe(true);
  });
});
