import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { AssetHandle } from "@yage/core";
import type { Texture } from "pixi.js";

const { mocks } = vi.hoisted(() => {
  class MockTexture {
    width: number;
    height: number;
    constructor(w = 64, h = 64) {
      this.width = w;
      this.height = h;
    }
  }

  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    destroyed = false;
    eventMode = "auto";
    cursor = "default";

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
      if (idx !== -1) { this.children.splice(idx, 1); child.parent = null; }
      return child;
    }

    removeFromParent(): void { this.parent?.removeChild(this); }

    destroy(): void { this.destroyed = true; this.removeFromParent(); }
  }

  class MockSprite extends MockContainer {
    texture: MockTexture;
    width = 0;
    height = 0;
    tint = 0xffffff;
    anchor = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };

    constructor(texture?: MockTexture) {
      super();
      this.texture = texture ?? new MockTexture();
      this.width = this.texture.width;
      this.height = this.texture.height;
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics { return this; }
    rect(): MockGraphics { return this; }
    roundRect(): MockGraphics { return this; }
    fill(): MockGraphics { return this; }
  }

  class MockNineSliceSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) this.texture = opts.texture;
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

  return { mocks: { MockContainer, MockSprite, MockGraphics, MockNineSliceSprite, MockTilingSprite, MockTexture } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  Graphics: mocks.MockGraphics,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { setAssetManager } from "./asset-helpers.js";
import { UIImage } from "./UIImage.js";
import { AssetManager } from "@yage/core";

const mockTexture = new mocks.MockTexture(100, 50);

beforeAll(() => {
  setYoga(Yoga);
  const am = new AssetManager();
  am.registerLoader("texture", { load: async () => mockTexture });
  // Pre-populate cache
  (am as unknown as { cache: Map<string, unknown> }).cache = new Map([["texture:test.png", mockTexture]]);
  setAssetManager(am);
});

describe("UIImage", () => {
  const handle = new AssetHandle<Texture>("texture", "test.png");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a sprite from an asset handle", () => {
    const img = new UIImage({ texture: handle });
    expect(img.displayObject).toBeDefined();
    expect(img.visible).toBe(true);
  });

  it("measureFunc returns texture natural dimensions", () => {
    const img = new UIImage({ texture: handle });
    // Calculate layout to trigger measure
    img.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    expect(img.yogaNode.getComputedWidth()).toBe(100);
    expect(img.yogaNode.getComputedHeight()).toBe(50);
  });

  it("applyLayout scales sprite to computed size", () => {
    const img = new UIImage({ texture: handle, width: 200, height: 100 });
    img.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    img.applyLayout();
    const sprite = img.container as unknown as InstanceType<typeof mocks.MockSprite>;
    expect(sprite.width).toBe(200);
    expect(sprite.height).toBe(100);
  });

  it("applies tint and alpha", () => {
    const img = new UIImage({ texture: handle, tint: 0xff0000, alpha: 0.5 });
    const sprite = img.container as unknown as InstanceType<typeof mocks.MockSprite>;
    expect(sprite.tint).toBe(0xff0000);
    expect(sprite.alpha).toBe(0.5);
  });

  it("update changes tint and alpha", () => {
    const img = new UIImage({ texture: handle });
    img.update({ tint: 0x00ff00, alpha: 0.3 });
    const sprite = img.container as unknown as InstanceType<typeof mocks.MockSprite>;
    expect(sprite.tint).toBe(0x00ff00);
    expect(sprite.alpha).toBe(0.3);
  });

  it("visibility can be toggled", () => {
    const img = new UIImage({ texture: handle });
    img.visible = false;
    expect(img.visible).toBe(false);
    img.visible = true;
    expect(img.visible).toBe(true);
  });

  it("destroy cleans up", () => {
    const img = new UIImage({ texture: handle });
    img.destroy();
    const sprite = img.container as unknown as InstanceType<typeof mocks.MockSprite>;
    expect(sprite.destroyed).toBe(true);
  });
});
