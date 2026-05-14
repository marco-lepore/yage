import { describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    scale = {
      x: 1,
      y: 1,
      set(this: { x: number; y: number }, ax: number, ay?: number) {
        this.x = ax;
        this.y = ay ?? ax;
      },
    };
    rotation = 0;
    parent: MockContainer | null = null;
    sortableChildren = false;
    isRenderGroup = false;
    zIndex = 0;
    label = "";
    eventMode = "passive";

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
      this.removeFromParent();
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown = null;
    static from(tex: unknown): MockSprite {
      const s = new MockSprite();
      s.texture = tex;
      return s;
    }
  }

  return { mocks: { MockContainer, MockSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
}));

import { Transform, Vec2 } from "@yagejs/core";
import type { Container } from "pixi.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { SpriteComponent } from "./SpriteComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import { ySort, ySortBy } from "./ySort.js";

describe("ySort", () => {
  it("returns position.y as the depth key", () => {
    const c = new mocks.MockContainer();
    c.position.y = 42;
    expect(ySort(c as unknown as Container)).toBe(42);
  });
});

describe("ySortBy", () => {
  it("adds the per-container offset to position.y", () => {
    const c = new mocks.MockContainer();
    c.position.y = 50;
    (c as unknown as { depthOffset: number }).depthOffset = 20;
    const sort = ySortBy(
      (x) => (x as unknown as { depthOffset?: number }).depthOffset,
    );
    expect(sort(c as unknown as Container)).toBe(70);
  });

  it("treats undefined offsets as 0", () => {
    const c = new mocks.MockContainer();
    c.position.y = 10;
    const sort = ySortBy(() => undefined);
    expect(sort(c as unknown as Container)).toBe(10);
  });
});

describe("DisplaySystem layer sort", () => {
  function setup(): ReturnType<typeof createRendererTestContext> & {
    system: DisplaySystem;
  } {
    const ctx = createRendererTestContext();
    const system = new DisplaySystem();
    system._setContext(ctx.context);
    system.onRegister?.(ctx.context);
    return { ...ctx, system };
  }

  function spawnSpriteAt(
    scene: ReturnType<typeof setup>["scene"],
    name: string,
    y: number,
  ): SpriteComponent {
    const entity = spawnEntityInScene(scene, name);
    entity.add(new Transform({ position: new Vec2(0, y) }));
    return entity.add(new SpriteComponent({ texture: {} as never }));
  }

  it("writes zIndex from the depth-key fn each frame", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const layer = tree.get("characters").container;

    const a = spawnSpriteAt(scene, "a", 30);
    const b = spawnSpriteAt(scene, "b", 10);
    const c = spawnSpriteAt(scene, "c", 20);
    layer.addChild(a.sprite);
    layer.addChild(b.sprite);
    layer.addChild(c.sprite);

    system.update();

    // After update, zIndex matches each sprite's y. Pixi's render
    // pipeline will then sort by zIndex; we verify the contract by
    // invoking sortChildren manually (mirrors the mock's pixi-render
    // behavior).
    expect(a.sprite.zIndex).toBe(30);
    expect(b.sprite.zIndex).toBe(10);
    expect(c.sprite.zIndex).toBe(20);

    layer.sortChildren();
    expect(layer.children).toEqual([b.sprite, c.sprite, a.sprite]);
  });

  it("re-writes zIndex when positions change between frames", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const layer = tree.get("characters").container;

    const a = spawnSpriteAt(scene, "a", 10);
    const b = spawnSpriteAt(scene, "b", 20);
    layer.addChild(a.sprite);
    layer.addChild(b.sprite);

    system.update();
    expect(a.sprite.zIndex).toBe(10);
    expect(b.sprite.zIndex).toBe(20);

    // a walks south past b.
    scene.findEntity("a")!.get(Transform).setPosition(0, 50);

    system.update();
    expect(a.sprite.zIndex).toBe(50);
    expect(b.sprite.zIndex).toBe(20);
  });

  it("does not touch zIndex on layers without a sort fn", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0 });
    const layer = tree.get("characters").container;

    const a = spawnSpriteAt(scene, "a", 30);
    a.sprite.zIndex = 999;
    layer.addChild(a.sprite);

    system.update();
    expect(a.sprite.zIndex).toBe(999);
  });

  it("flips sortableChildren on a layer with a depth-key fn", () => {
    const { tree } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const layer = tree.get("characters").container;
    expect(layer.sortableChildren).toBe(true);
  });
});
