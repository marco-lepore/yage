import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    tint = 0xffffff;
    blendMode = "inherit";
    eventMode = "passive";
    anchor = {
      x: 0,
      y: 0,
      set: vi.fn(function (
        this: { x: number; y: number },
        ax: number,
        ay: number,
      ) {
        this.x = ax;
        this.y = ay;
      }),
    };

    boundsBox = { x: 0, y: 0, width: 0, height: 0 };

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
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

    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }

    getLocalBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.boundsBox };
    }

    updateLocalTransform(): void {}

    // Identity local transform → world bounds equal the local box, so the facet
    // assertions below read straight through. renderFacet.test.ts covers the
    // non-identity (zoom / rotation) mapping math against a real Pixi Matrix.
    localTransform = {
      apply(p: { x: number; y: number }): { x: number; y: number } {
        return { x: p.x, y: p.y };
      },
    };

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockPoint {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
  }

  class MockSprite extends MockContainer {
    texture: unknown = null;
    static from = vi.fn((_tex: unknown): MockSprite => {
      const s = new MockSprite();
      s.texture = _tex;
      return s;
    });
  }

  // Map-backed stand-in for Pixi's global asset cache — `Texture.from(key)`
  // reads it just like installed Pixi, so `registerTexture` entries resolve
  // and unknown keys come back undefined (which the resolver turns into a
  // loud error).
  const cacheMap = new Map<string, unknown>();
  const cache = {
    has: (key: string) => cacheMap.has(key),
    get: (key: string) => cacheMap.get(key),
    set: (key: string, value: unknown) => void cacheMap.set(key, value),
    remove: (key: string) => void cacheMap.delete(key),
  };

  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class MockTexture {
    static from = vi.fn((key: string) => cacheMap.get(key));
  }

  return {
    mocks: { MockContainer, MockSprite, MockTexture, MockPoint, cacheMap, cache },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  Texture: mocks.MockTexture,
  Point: mocks.MockPoint,
  Assets: { cache: mocks.cache },
}));

import { Transform } from "@yagejs/core";
import { clearRegisteredTextures, registerTexture } from "./assets.js";
import { SpriteComponent } from "./SpriteComponent.js";
import type { TextureResource } from "./public-types.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

/** Register a fake texture under `key` and return it. */
function registerFakeTexture(key: string): TextureResource {
  const tex = { label: key } as unknown as TextureResource;
  registerTexture(key, tex);
  return tex;
}

describe("SpriteComponent", () => {
  beforeEach(() => {
    mocks.MockSprite.from.mockClear();
    mocks.MockTexture.from.mockClear();
    clearRegisteredTextures();
    mocks.cacheMap.clear();
  });

  it("creates a sprite from texture", () => {
    const tex = { label: "test" };
    const comp = new SpriteComponent({ texture: tex as never });
    expect(mocks.MockSprite.from).toHaveBeenCalledWith(tex);
    expect(comp.sprite).toBeDefined();
  });

  it("defaults to 'default' layer", () => {
    const comp = new SpriteComponent({ texture: {} as never });
    expect(comp.layerName).toBe("default");
  });

  it("accepts custom layer name", () => {
    const comp = new SpriteComponent({ texture: {} as never, layer: "ui" });
    expect(comp.layerName).toBe("ui");
  });

  it("sets anchor when provided", () => {
    const comp = new SpriteComponent({
      texture: {} as never,
      anchor: { x: 0.5, y: 0.5 },
    });
    expect(comp.sprite.anchor.set).toHaveBeenCalledWith(0.5, 0.5);
  });

  it("sets visibility when provided", () => {
    const comp = new SpriteComponent({ texture: {} as never, visible: false });
    expect(comp.sprite.visible).toBe(false);
  });

  it("sets tint when provided", () => {
    const comp = new SpriteComponent({ texture: {} as never, tint: 0xff0000 });
    expect(comp.sprite.tint).toBe(0xff0000);
  });

  it("sets alpha when provided", () => {
    const comp = new SpriteComponent({ texture: {} as never, alpha: 0.5 });
    expect(comp.sprite.alpha).toBe(0.5);
  });

  it("applies the interactive option, defaulting eventMode to static", () => {
    const comp = new SpriteComponent({
      texture: {} as never,
      interactive: {},
    });
    expect(comp.sprite.eventMode).toBe("static");
  });

  it("onAdd adds sprite to correct layer container", () => {
    const { scene, layerManager } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new SpriteComponent({ texture: {} as never }));

    const layerContainer = layerManager.defaultLayer
      .container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.sprite);
  });

  it("setTexture replaces the sprite texture via a registered key", () => {
    const comp = new SpriteComponent({ texture: {} as never });
    const next = registerFakeTexture("new-texture");
    comp.setTexture("new-texture");
    expect(mocks.MockTexture.from).toHaveBeenCalledWith("new-texture");
    expect(comp.sprite.texture).toBe(next);
  });

  it("throws on an unresolvable texture key, naming the key", () => {
    expect(() => new SpriteComponent({ texture: "missing.png" })).toThrowError(
      /missing\.png/,
    );
  });

  it("tint setter updates sprite tint", () => {
    const comp = new SpriteComponent({ texture: {} as never });
    comp.tint = 0x00ff00;
    expect(comp.sprite.tint).toBe(0x00ff00);
    expect(comp.tint).toBe(0x00ff00);
  });

  it("alpha setter updates sprite alpha", () => {
    const comp = new SpriteComponent({ texture: {} as never });
    comp.alpha = 0.3;
    expect(comp.sprite.alpha).toBe(0.3);
    expect(comp.alpha).toBe(0.3);
  });

  it("onDestroy removes sprite from parent and destroys it", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new SpriteComponent({ texture: {} as never }));

    const sprite = comp.sprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(sprite.parent).not.toBeNull();

    comp.onDestroy?.();
    expect(sprite.parent).toBeNull();
    expect(sprite.destroyed).toBe(true);
  });

  describe("serialization", () => {
    it("serializes a key-constructed sprite to a full SpriteData", () => {
      registerFakeTexture("hero.png");
      const comp = new SpriteComponent({
        texture: "hero.png",
        anchor: { x: 0.5, y: 0.5 },
        tint: 0xff0000,
      });

      const data = comp.serialize();
      expect(data.textureKey).toBe("hero.png");
      expect(data.layer).toBe("default");
      expect(data.anchor).toEqual({ x: 0.5, y: 0.5 });
      expect(data.tint).toBe(0xff0000);
    });

    it("setTexture(key) updates the serialized key", () => {
      registerFakeTexture("idle.png");
      registerFakeTexture("run.png");
      const comp = new SpriteComponent({ texture: "idle.png" });

      comp.setTexture("run.png");
      expect(comp.serialize().textureKey).toBe("run.png");
    });

    it("round-trips via fromSnapshot after re-registration", () => {
      registerFakeTexture("boss.png");
      const comp = new SpriteComponent({
        texture: "boss.png",
        anchor: { x: 0.5, y: 1 },
        alpha: 0.5,
      });
      const data = comp.serialize();

      // A fresh boot: the old registration is gone; the game re-registers a
      // new runtime texture under the same key before restoring.
      clearRegisteredTextures();
      const rebaked = registerFakeTexture("boss.png");

      const restored = SpriteComponent.fromSnapshot(data);
      expect(restored.sprite.texture).toBe(rebaked);
      expect(restored.serialize()).toEqual(data);
    });

    it("fromSnapshot with a missing key throws, naming the key", () => {
      const data = {
        layer: "default",
        textureKey: "never-registered.png",
      };
      expect(() =>
        SpriteComponent.fromSnapshot(data as never),
      ).toThrowError(/never-registered\.png/);
    });
  });

  describe("inspectRender", () => {
    it("reports world-space bounds and local visibility", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const comp = entity.add(new SpriteComponent({ texture: {} as never }));
      const sprite = comp.sprite as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      sprite.boundsBox = { x: 4, y: 8, width: 16, height: 16 };

      const facet = comp.inspectRender();
      expect(facet.bounds).toEqual({ x: 4, y: 8, width: 16, height: 16 });
      expect(facet.visible).toBe(true);
    });

    it("reflects a visibility toggle", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const comp = entity.add(new SpriteComponent({ texture: {} as never }));
      const sprite = comp.sprite as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      sprite.boundsBox = { x: 0, y: 0, width: 10, height: 10 };
      comp.sprite.visible = false;

      const facet = comp.inspectRender();
      expect(facet.visible).toBe(false);
      // Geometry-truthful: a hidden-but-sized object still reports its real box;
      // `bounds: null` is reserved for genuinely empty geometry.
      expect(facet.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    });

    it("returns null bounds for a zero-area display object", () => {
      const comp = new SpriteComponent({ texture: {} as never });
      expect(comp.inspectRender().bounds).toBeNull();
    });
  });
});
