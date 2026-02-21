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
    anchor = { x: 0, y: 0, set: vi.fn(function (this: { x: number; y: number }, ax: number, ay: number) { this.x = ax; this.y = ay; }) };

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

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown = null;
    static from = vi.fn((_tex: unknown): MockSprite => {
      const s = new MockSprite();
      s.texture = _tex;
      return s;
    });
  }

  return { mocks: { MockContainer, MockSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
}));

import { Transform } from "@yage/core";
import { SpriteComponent } from "./SpriteComponent.js";
import { createRendererTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("SpriteComponent", () => {
  beforeEach(() => {
    mocks.MockSprite.from.mockClear();
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
    const comp = new SpriteComponent({ texture: {} as never, anchor: { x: 0.5, y: 0.5 } });
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

  it("onAdd adds sprite to correct layer container", () => {
    const { scene, layerManager } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new SpriteComponent({ texture: {} as never }));

    const layerContainer = layerManager.defaultLayer.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.sprite);
  });

  it("onDestroy removes sprite from parent and destroys it", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new SpriteComponent({ texture: {} as never }));

    const sprite = comp.sprite as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(sprite.parent).not.toBeNull();

    comp.onDestroy?.();
    expect(sprite.parent).toBeNull();
    expect(sprite.destroyed).toBe(true);
  });
});
