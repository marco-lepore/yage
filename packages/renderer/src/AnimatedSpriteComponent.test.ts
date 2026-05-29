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

    boundsBox = { x: 0, y: 0, width: 0, height: 0 };

    getBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.boundsBox };
    }

    toLocal(p: { x: number; y: number }): { x: number; y: number } {
      return { x: p.x, y: p.y };
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockAnimatedSprite extends MockContainer {
    textures: unknown[];
    animationSpeed = 1;
    loop = true;
    playing = false;
    onComplete: (() => void) | null = null;
    tint: number | string = 0xffffff;
    anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

    constructor(textures: unknown[]) {
      super();
      this.textures = textures;
    }

    play(): void {
      this.playing = true;
    }

    stop(): void {
      this.playing = false;
    }
  }

  return { mocks: { MockContainer, MockAnimatedSprite } };
});

vi.mock("pixi.js", () => {
  class MockTexture {
    source = { scaleMode: "nearest" };
    width: number;
    height: number;
    constructor(opts?: { source?: unknown; frame?: { width: number; height: number } }) {
      this.width = opts?.frame?.width ?? 96;
      this.height = opts?.frame?.height ?? 48;
    }
    static from(key: string): MockTexture {
      const t = new MockTexture();
      (t as unknown as Record<string, unknown>).label = key;
      t.width = 96;
      t.height = 48;
      return t;
    }
  }
  class MockRectangle {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
  }
  class MockPoint {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
  }
  return {
    Container: mocks.MockContainer,
    AnimatedSprite: mocks.MockAnimatedSprite,
    Texture: MockTexture,
    Rectangle: MockRectangle,
    Point: MockPoint,
    Assets: { get: () => undefined },
  };
});

import { Transform } from "@yagejs/core";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import { createRendererTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("AnimatedSpriteComponent", () => {
  const textures = [{ label: "frame1" }, { label: "frame2" }] as never[];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an animated sprite from textures", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    expect(comp.animatedSprite).toBeDefined();
    expect((comp.animatedSprite as unknown as InstanceType<typeof mocks.MockAnimatedSprite>).textures).toBe(textures);
  });

  it("defaults to 'default' layer", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    expect(comp.layerName).toBe("default");
  });

  it("accepts custom layer name", () => {
    const comp = new AnimatedSpriteComponent({ textures, layer: "fx" });
    expect(comp.layerName).toBe("fx");
  });

  it("applies component-level anchor from a Vec2-like option", () => {
    const comp = new AnimatedSpriteComponent({
      textures,
      anchor: { x: 0.5, y: 1 },
    });
    expect(comp.animatedSprite.anchor.x).toBe(0.5);
    expect(comp.animatedSprite.anchor.y).toBe(1);
  });

  it("applies component-level anchor from a tuple", () => {
    const comp = new AnimatedSpriteComponent({ textures, anchor: [0.5, 0.5] });
    expect(comp.animatedSprite.anchor.x).toBe(0.5);
    expect(comp.animatedSprite.anchor.y).toBe(0.5);
  });

  it("applies tint when provided (numeric and string)", () => {
    const num = new AnimatedSpriteComponent({ textures, tint: 0xff0000 });
    expect(num.animatedSprite.tint).toBe(0xff0000);

    const str = new AnimatedSpriteComponent({ textures, tint: "#00ff00" });
    expect(str.animatedSprite.tint).toBe("#00ff00");
  });

  it("play() starts the animation", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    comp.play();
    expect(comp.isPlaying).toBe(true);
  });

  it("play() sets speed when provided", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    comp.play({ speed: 0.5 });
    expect(comp.animatedSprite.animationSpeed).toBe(0.5);
  });

  it("play() sets loop when provided", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    comp.play({ loop: false });
    expect(comp.animatedSprite.loop).toBe(false);
  });

  it("play() sets onComplete when provided", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    const cb = vi.fn();
    comp.play({ onComplete: cb });
    expect(comp.animatedSprite.onComplete).toBe(cb);
  });

  it("stop() stops the animation", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    comp.play();
    expect(comp.isPlaying).toBe(true);
    comp.stop();
    expect(comp.isPlaying).toBe(false);
  });

  it("isPlaying reflects animation state", () => {
    const comp = new AnimatedSpriteComponent({ textures });
    expect(comp.isPlaying).toBe(false);
    comp.play();
    expect(comp.isPlaying).toBe(true);
  });

  it("onAdd adds animated sprite to correct layer container", () => {
    const { scene, layerManager } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new AnimatedSpriteComponent({ textures }));

    const layerContainer = layerManager.defaultLayer.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.animatedSprite);
  });

  it("onDestroy removes animated sprite from parent and destroys it", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new AnimatedSpriteComponent({ textures }));

    const anim = comp.animatedSprite as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(anim.parent).not.toBeNull();

    comp.onDestroy?.();
    expect(anim.parent).toBeNull();
    expect(anim.destroyed).toBe(true);
  });

  describe("serialization", () => {
    it("construction with StripFrameSource resolves frames via sliceSheet", () => {
      const comp = new AnimatedSpriteComponent({
        source: { sheet: "player.png", frameWidth: 48 },
      });
      // sliceSheet(player.png, 48) → mock texture width=96 / 48 = 2 frames
      expect(comp.animatedSprite.textures).toHaveLength(2);
    });

    it("serialize returns source + layer when constructed with source", () => {
      const source = { sheet: "player.png", frameWidth: 48 };
      const comp = new AnimatedSpriteComponent({ source, layer: "fg" });
      expect(comp.serialize()).toEqual({ source, layer: "fg" });
    });

    it("serialize returns null with warning when constructed with raw textures", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const comp = new AnimatedSpriteComponent({ textures });
      expect(comp.serialize()).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("fromSnapshot round-trips", () => {
      const source = { sheet: "player.png", frameWidth: 48 };
      const original = new AnimatedSpriteComponent({ source, layer: "bg" });
      const data = original.serialize()!;
      const restored = AnimatedSpriteComponent.fromSnapshot(data);
      expect(restored.layerName).toBe("bg");
      expect(restored.serialize()).toEqual(data);
    });

    it("round-trips anchor and tint", () => {
      const source = { sheet: "player.png", frameWidth: 48 };
      const original = new AnimatedSpriteComponent({
        source,
        anchor: { x: 0.5, y: 1 },
        tint: 0xff0000,
      });
      const data = original.serialize()!;
      expect(data.anchor).toEqual({ x: 0.5, y: 1 });
      expect(data.tint).toBe(0xff0000);

      const restored = AnimatedSpriteComponent.fromSnapshot(data);
      expect(restored.animatedSprite.anchor.x).toBe(0.5);
      expect(restored.animatedSprite.anchor.y).toBe(1);
      expect(restored.animatedSprite.tint).toBe(0xff0000);
      expect(restored.serialize()).toEqual(data);
    });

    it("throws when neither source nor textures provided", () => {
      expect(() => new AnimatedSpriteComponent({} as never)).toThrow(
        /requires either/,
      );
    });
  });

  describe("inspectRender", () => {
    it("reports world-space bounds and resolved visibility", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const comp = entity.add(new AnimatedSpriteComponent({ textures }));
      const sprite = comp.animatedSprite as unknown as InstanceType<
        typeof mocks.MockAnimatedSprite
      >;
      sprite.boundsBox = { x: 1, y: 2, width: 96, height: 48 };

      const facet = comp.inspectRender();
      expect(facet.bounds).toEqual({ x: 1, y: 2, width: 96, height: 48 });
      expect(facet.visible).toBe(true);
    });

    it("reflects a visibility toggle", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const comp = entity.add(new AnimatedSpriteComponent({ textures }));
      const sprite = comp.animatedSprite as unknown as InstanceType<
        typeof mocks.MockAnimatedSprite
      >;
      sprite.boundsBox = { x: 0, y: 0, width: 10, height: 10 };
      comp.animatedSprite.visible = false;

      expect(comp.inspectRender().visible).toBe(false);
    });
  });
});
