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
  it("orders containers by ascending position.y", () => {
    const a = new mocks.MockContainer();
    const b = new mocks.MockContainer();
    const c = new mocks.MockContainer();
    a.position.y = 30;
    b.position.y = 10;
    c.position.y = 20;

    const sorted = [a, b, c].sort(ySort as unknown as (a: unknown, b: unknown) => number);
    expect(sorted).toEqual([b, c, a]);
  });
});

describe("ySortBy", () => {
  it("adds the per-container offset before comparing", () => {
    const a = new mocks.MockContainer();
    const b = new mocks.MockContainer();
    // Raw y order would be [a, b], but b's bigger offset pulls it ahead.
    a.position.y = 50;
    b.position.y = 40;
    const offsetOf = (c: Container): number | undefined =>
      (c as unknown as { depthOffset?: number }).depthOffset;
    (a as unknown as { depthOffset: number }).depthOffset = 0;
    (b as unknown as { depthOffset: number }).depthOffset = 20; // effective y = 60

    const sort = ySortBy(offsetOf);
    const sorted = [a, b].sort(sort as unknown as (a: unknown, b: unknown) => number);
    expect(sorted).toEqual([a, b]);
  });

  it("treats undefined offsets as 0", () => {
    const a = new mocks.MockContainer();
    const b = new mocks.MockContainer();
    a.position.y = 10;
    b.position.y = 20;
    const sort = ySortBy(() => undefined);
    const sorted = [b, a].sort(sort as unknown as (x: unknown, y: unknown) => number);
    expect(sorted).toEqual([a, b]);
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

  it("paints insertion-order by default (no sort)", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0 });
    const layer = tree.get("characters").container;

    const a = spawnSpriteAt(scene, "a", 30);
    const b = spawnSpriteAt(scene, "b", 10);
    const c = spawnSpriteAt(scene, "c", 20);
    // Manually add to the layer in insertion order — SpriteComponent's
    // layer wiring isn't relevant to the assertion; we're only checking
    // that DisplaySystem doesn't re-order without a sort fn.
    layer.addChild(a.sprite);
    layer.addChild(b.sprite);
    layer.addChild(c.sprite);

    system.update();

    expect(layer.children).toEqual([a.sprite, b.sprite, c.sprite]);
  });

  it("re-sorts a layer's children by ySort each frame", () => {
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

    // Paint order: lowest-y first (back), highest-y last (front).
    expect(layer.children).toEqual([b.sprite, c.sprite, a.sprite]);
  });

  it("picks up position changes between frames", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const layer = tree.get("characters").container;

    const a = spawnSpriteAt(scene, "a", 10);
    const b = spawnSpriteAt(scene, "b", 20);
    layer.addChild(a.sprite);
    layer.addChild(b.sprite);

    system.update();
    expect(layer.children).toEqual([a.sprite, b.sprite]);

    // a walks "south" past b; next frame b should now paint behind a.
    scene.findEntity("a")!.get(Transform).setPosition(0, 50);

    system.update();
    expect(layer.children).toEqual([b.sprite, a.sprite]);
  });

  it("flips sortableChildren on a layer with a sort comparator", () => {
    const { tree } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const layer = tree.get("characters").container;
    expect(layer.sortableChildren).toBe(true);
  });
});
