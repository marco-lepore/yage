import { beforeEach, describe, it, expect, vi } from "vitest";
import { AssetHandle } from "@yagejs/core";
import type { Texture } from "pixi.js";

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
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    destroyed = false;

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
      const i = this.children.indexOf(child);
      if (i !== -1) {
        this.children.splice(i, 1);
        child.parent = null;
      }
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    private _lastFillW = 0;
    private _lastFillH = 0;
    clearCalled = false;
    /** How many times the geometry has been rebuilt. */
    drawCount = 0;
    clear(): MockGraphics {
      this.clearCalled = true;
      this.drawCount++;
      return this;
    }
    rect(_x: number, _y: number, w: number, h: number): MockGraphics {
      this._lastFillW = w;
      this._lastFillH = h;
      return this;
    }
    roundRect(_x: number, _y: number, w: number, h: number): MockGraphics {
      this._lastFillW = w;
      this._lastFillH = h;
      return this;
    }
    fill(): MockGraphics {
      return this;
    }
    get lastWidth() {
      return this._lastFillW;
    }
    get lastHeight() {
      return this._lastFillH;
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
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
    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) {
        this.texture = opts.texture;
        this.width = (opts.width as number) ?? 0;
        this.height = (opts.height as number) ?? 0;
      }
    }
  }

  return {
    mocks: {
      MockContainer,
      MockGraphics,
      MockSprite,
      MockNineSliceSprite,
      MockTilingSprite,
      mockTexture: { width: 64, height: 64 },
      registeredTextures: new Map<string, unknown>(),
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

vi.mock("@yagejs/renderer", () => ({
  registerTexture: (key: string, texture: unknown) => {
    mocks.registeredTextures.set(key, texture);
  },
  resolveTextureInput: (input: unknown) => {
    const key =
      typeof input === "string" ? input : (input as { path?: string }).path;
    return (key && mocks.registeredTextures.get(key)) ?? mocks.mockTexture;
  },
}));

import { registerTexture } from "@yagejs/renderer";
import { BackgroundRenderer } from "./background-renderer.js";

describe("BackgroundRenderer", () => {
  beforeEach(() => {
    mocks.registeredTextures.clear();
  });

  it("resolves a registered texture key", () => {
    const texture = { width: 80, height: 40 };
    registerTexture("runtime-background", texture as never);
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();

    renderer.set(
      { texture: "runtime-background", mode: "stretch" },
      parent as never,
    );

    const sprite = parent.children[0] as InstanceType<typeof mocks.MockSprite>;
    expect(sprite.texture).toBe(texture);
  });

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

  it("skips the redraw when the size has not changed", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set({ color: 0xff0000 }, parent as never);
    const g = parent.children[0] as InstanceType<typeof mocks.MockGraphics>;

    renderer.resize(200, 100);
    const afterFirst = g.drawCount;
    renderer.resize(200, 100);
    renderer.resize(200, 100);

    expect(afterFirst).toBe(1);
    expect(g.drawCount).toBe(1);
  });

  it("redraws when the size changes", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set({ color: 0xff0000 }, parent as never);
    const g = parent.children[0] as InstanceType<typeof mocks.MockGraphics>;

    renderer.resize(200, 100);
    renderer.resize(200, 120);

    expect(g.drawCount).toBe(2);
    expect(g.lastHeight).toBe(120);
  });

  it("redraws at an unchanged size after the options change", () => {
    // A button swapping to its hover colour calls `set` then `resize` with the
    // same cached size; the new colour has to reach the geometry.
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set({ color: 0xff0000 }, parent as never);
    renderer.resize(200, 100);
    const g = parent.children[0] as InstanceType<typeof mocks.MockGraphics>;
    const before = g.drawCount;

    renderer.set({ color: 0x00ff00 }, parent as never);

    // `set` re-applies the cached size itself, so the redraw has happened by
    // the time it returns; the caller's own same-size `resize` is then a no-op.
    expect(g.drawCount).toBe(before + 1);
    renderer.resize(200, 100);
    expect(g.drawCount).toBe(before + 1);
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
    renderer.set(
      { texture: handle, mode: "nine-slice", nineSlice: 10 },
      parent as never,
    );
    expect(parent.children[0]).toBeInstanceOf(mocks.MockNineSliceSprite);
  });

  it("applies the insets stated with a replaced nine-slice texture", () => {
    const frameA = { width: 64, height: 64 };
    const frameB = { width: 96, height: 96 };
    registerTexture("frame-a", frameA as never);
    registerTexture("frame-b", frameB as never);
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    renderer.set(
      { texture: "frame-a", mode: "nine-slice", nineSlice: 4 },
      parent as never,
    );
    const sprite = parent.children[0] as InstanceType<
      typeof mocks.MockNineSliceSprite
    >;

    renderer.set(
      {
        texture: "frame-b",
        mode: "nine-slice",
        nineSlice: { left: 12, top: 10, right: 12, bottom: 16 },
      },
      parent as never,
    );

    // The display object is reused, so the slice guides reach the sprite from
    // the property path rather than from its constructor.
    expect(parent.children[0]).toBe(sprite);
    expect(sprite.texture).toBe(frameB);
    expect([
      sprite.leftWidth,
      sprite.topHeight,
      sprite.rightWidth,
      sprite.bottomHeight,
    ]).toEqual([12, 10, 12, 16]);
  });

  it("warns when a nine-slice background is smaller than its insets", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set(
      {
        texture: handle,
        mode: "nine-slice",
        nineSlice: { left: 8, top: 16, right: 8, bottom: 20 },
      },
      parent as never,
    );

    renderer.resize(100, 34);

    const hit = warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes("nine-slice background"));
    expect(hit).toContain("height 34.0px is under the 36px");
    warn.mockRestore();
  });

  it("does not warn for a nine-slice background with room", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set(
      { texture: handle, mode: "nine-slice", nineSlice: 8 },
      parent as never,
    );

    renderer.resize(100, 40);

    expect(
      warn.mock.calls.filter((c) =>
        String(c[0]).includes("nine-slice background"),
      ),
    ).toHaveLength(0);
    warn.mockRestore();
  });

  it("warns again once the box has fitted in between", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set(
      { texture: handle, mode: "nine-slice", nineSlice: 20 },
      parent as never,
    );
    const count = () =>
      warn.mock.calls.filter((c) =>
        String(c[0]).includes("nine-slice background"),
      ).length;

    renderer.resize(100, 30);
    expect(count()).toBe(1);
    // Still too small: one warning per episode.
    renderer.resize(100, 32);
    expect(count()).toBe(1);
    // Room for the middle row, so the episode is over.
    renderer.resize(100, 80);
    expect(count()).toBe(1);
    renderer.resize(100, 30);
    expect(count()).toBe(2);
    warn.mockRestore();
  });

  it("warns when replaced nine-slice art needs more room than the box has", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set(
      { texture: handle, mode: "nine-slice", nineSlice: 8 },
      parent as never,
    );
    renderer.resize(100, 40);

    renderer.set(
      { texture: handle, mode: "nine-slice", nineSlice: 30 },
      parent as never,
    );

    const hit = warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes("nine-slice background"));
    expect(hit).toContain("height 40.0px is under the 60px");
    warn.mockRestore();
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

  it("resets omitted texture properties to their defaults", () => {
    const renderer = new BackgroundRenderer();
    const parent = new mocks.MockContainer();
    const handle = new AssetHandle<Texture>("texture", "test.png");
    renderer.set(
      {
        texture: handle,
        mode: "tile",
        tint: 0xff0000,
        alpha: 0.5,
        tileScale: 2,
      },
      parent as never,
    );

    renderer.set({ texture: handle, mode: "tile" }, parent as never);

    const tile = parent.children[0] as InstanceType<
      typeof mocks.MockTilingSprite
    > & { tint: number };
    expect(tile.alpha).toBe(1);
    expect(tile.tint).toBe(0xffffff);
    expect([tile.tileScale.x, tile.tileScale.y]).toEqual([1, 1]);
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
