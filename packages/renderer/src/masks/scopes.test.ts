/**
 * Scope-level integration tests for the masks system. Exercises component,
 * layer, and scene scopes end-to-end against the mock pixi/test-helpers
 * stack, plus a TextComponent-specific masking sanity check (verifies the
 * "Text masking works" open question from the brainstorm doc).
 */
import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    filters: unknown = null;
    mask: MockContainer | null = null;
    maskInverse = false;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    eventMode = "passive";
    destroyed = false;
    setMask(opts: { mask: MockContainer | null; inverse?: boolean }): void {
      this.mask = opts.mask;
      this.maskInverse = opts.inverse ?? false;
    }
    addChild(c: MockContainer): MockContainer {
      this.children.push(c);
      c.parent = this;
      return c;
    }
    removeChild(c: MockContainer): MockContainer {
      const i = this.children.indexOf(c);
      if (i !== -1) {
        this.children.splice(i, 1);
        c.parent = null;
      }
      return c;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
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
    rect(): MockGraphics {
      return this;
    }
    roundRect(): MockGraphics {
      return this;
    }
    fill(): MockGraphics {
      return this;
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown = null;
    static from = vi.fn((tex: unknown): MockSprite => {
      const s = new MockSprite();
      s.texture = tex;
      return s;
    });
    anchor = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    tint = 0xffffff;
    alpha = 1;
    visible = true;
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    anchor = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    tint = 0xffffff;
    alpha = 1;
    visible = true;

    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
    }
  }

  class MockFilter {
    enabled = true;
    constructor(public label = "filter") {}
  }

  return {
    mocks: { MockContainer, MockGraphics, MockSprite, MockText, MockFilter },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Sprite: mocks.MockSprite,
  Text: mocks.MockText,
  Filter: mocks.MockFilter,
  AlphaFilter: class extends mocks.MockFilter {
    alpha: number;
    constructor(opts?: { alpha?: number }) {
      super("alpha");
      this.alpha = opts?.alpha ?? 1;
    }
  },
}));

import { Transform } from "@yagejs/core";
import { SpriteComponent } from "../SpriteComponent.js";
import { TextComponent } from "../TextComponent.js";
import { rectMask } from "./rectMask.js";
import { graphicsMask } from "./graphicsMask.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "../test-helpers.js";

describe("Mask scopes — end-to-end", () => {
  describe("component scope", () => {
    it("setMask attaches a rect mask to a SpriteComponent", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));

      const handle = sprite.setMask(
        rectMask({ x: 0, y: 0, width: 32, height: 32 }),
      );
      const spriteAsContainer = sprite.sprite as never as InstanceType<
        typeof mocks.MockContainer
      >;
      expect(spriteAsContainer.mask).not.toBeNull();
      expect(handle.inverse).toBe(false);
    });

    it("setMask twice replaces the previous mask", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));
      const spriteAsContainer = sprite.sprite as never as InstanceType<
        typeof mocks.MockContainer
      >;

      sprite.setMask(rectMask({ x: 0, y: 0, width: 10, height: 10 }));
      const firstMask = spriteAsContainer.mask;
      sprite.setMask(rectMask({ x: 0, y: 0, width: 20, height: 20 }));
      const secondMask = spriteAsContainer.mask;

      expect(secondMask).not.toBe(firstMask);
      // Old mask Graphics destroyed and removed from the sprite's children.
      expect(spriteAsContainer.children).not.toContain(firstMask);
      expect(spriteAsContainer.children).toContain(secondMask);
    });

    it("clearMask detaches and destroys the owned mask", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));
      const spriteAsContainer = sprite.sprite as never as InstanceType<
        typeof mocks.MockContainer
      >;

      sprite.setMask(rectMask({ x: 0, y: 0, width: 10, height: 10 }));
      sprite.clearMask();
      expect(spriteAsContainer.mask).toBeNull();
      expect(spriteAsContainer.children.length).toBe(0);
    });

    it("entity destroy removes the component-scope mask", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));
      const spriteAsContainer = sprite.sprite as never as InstanceType<
        typeof mocks.MockContainer
      >;

      sprite.setMask(rectMask({ x: 0, y: 0, width: 10, height: 10 }));
      sprite.onDestroy?.();
      expect(spriteAsContainer.mask).toBeNull();
    });

    it("TextComponent supports masking (sanity check — extends Container)", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const text = entity.add(new TextComponent({ text: "hello" }));
      const textAsContainer = text.text as never as InstanceType<
        typeof mocks.MockContainer
      >;

      const handle = text.setMask(
        graphicsMask((g) => {
          g.clear();
          g.rect(0, 0, 100, 30);
          g.fill({ color: 0xffffff });
        }),
      );

      expect(textAsContainer.mask).not.toBeNull();
      // Mask Graphics is parented under the Text node.
      expect(textAsContainer.children.length).toBe(1);

      // Redraw works (graphicsMask)
      expect(() => handle.redraw()).not.toThrow();

      text.onDestroy?.();
      expect(textAsContainer.mask).toBeNull();
    });
  });

  describe("layer scope", () => {
    it("setMask attaches a mask to the layer container", () => {
      const { tree } = createRendererTestContext();
      const layer = tree.defaultLayer;
      const layerContainer = layer.container as never as InstanceType<
        typeof mocks.MockContainer
      >;

      layer.setMask(rectMask({ x: 0, y: 0, width: 800, height: 600 }));
      expect(layerContainer.mask).not.toBeNull();
    });

    it("scene exit tears down layer-scope masks", () => {
      const { scene, provider } = createRendererTestContext();
      const tree = provider.getTree(scene)!;
      const layer = tree.defaultLayer;
      const layerContainer = layer.container as never as InstanceType<
        typeof mocks.MockContainer
      >;

      layer.setMask(rectMask({ x: 0, y: 0, width: 10, height: 10 }));
      expect(layerContainer.mask).not.toBeNull();

      provider.destroyForScene(scene);
      expect(layerContainer.mask).toBeNull();
    });
  });

  describe("scene scope", () => {
    it("setMask attaches a mask to the per-scene root", () => {
      const { tree, root } = createRendererTestContext();
      tree.setMask(rectMask({ x: 0, y: 0, width: 800, height: 600 }));
      expect(root.mask).not.toBeNull();
    });

    it("scene exit tears down the scene-scope mask", () => {
      const { scene, provider, root } = createRendererTestContext();
      const tree = provider.getTree(scene)!;
      tree.setMask(rectMask({ x: 0, y: 0, width: 10, height: 10 }));
      expect(root.mask).not.toBeNull();

      provider.destroyForScene(scene);
      expect(root.mask).toBeNull();
    });
  });

  describe("cross-scope independence", () => {
    it("each scope's mask lives on its own container, no cross-talk", () => {
      const { scene, tree, root, layerManager } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));

      sprite.setMask(rectMask({ x: 0, y: 0, width: 10, height: 10 }));
      tree.defaultLayer.setMask(
        rectMask({ x: 0, y: 0, width: 200, height: 200 }),
      );
      tree.setMask(rectMask({ x: 0, y: 0, width: 800, height: 600 }));

      const spriteAsContainer = sprite.sprite as never as InstanceType<
        typeof mocks.MockContainer
      >;
      const layerContainer = layerManager.defaultLayer
        .container as never as InstanceType<typeof mocks.MockContainer>;

      expect(spriteAsContainer.mask).not.toBeNull();
      expect(layerContainer.mask).not.toBeNull();
      expect(root.mask).not.toBeNull();
      expect(spriteAsContainer.mask).not.toBe(layerContainer.mask);
      expect(layerContainer.mask).not.toBe(root.mask);
    });

    it("entity destroy clears component mask but leaves layer/scene masks intact", () => {
      const { scene, tree, root, layerManager } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));

      sprite.setMask(rectMask({ x: 0, y: 0, width: 10, height: 10 }));
      tree.defaultLayer.setMask(
        rectMask({ x: 0, y: 0, width: 200, height: 200 }),
      );
      tree.setMask(rectMask({ x: 0, y: 0, width: 800, height: 600 }));

      const spriteAsContainer = sprite.sprite as never as InstanceType<
        typeof mocks.MockContainer
      >;
      const layerContainer = layerManager.defaultLayer
        .container as never as InstanceType<typeof mocks.MockContainer>;

      sprite.onDestroy?.();
      expect(spriteAsContainer.mask).toBeNull();
      expect(layerContainer.mask).not.toBeNull();
      expect(root.mask).not.toBeNull();
    });
  });
});
