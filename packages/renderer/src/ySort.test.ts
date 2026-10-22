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
import { DisplaySystem } from "./DisplaySystem.js";
import type { LayerSortFn } from "./LayerDef.js";
import { SpriteComponent } from "./SpriteComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import { ySort } from "./ySort.js";

describe("ySort", () => {
  it("keys an item at its y plus its sortOffset", () => {
    expect(ySort({ x: 5, y: 42, sortOffset: 0, entity: undefined })).toBe(42);
    expect(ySort({ x: 5, y: 50, sortOffset: 20, entity: undefined })).toBe(70);
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
    layer.addChild(a.renderObject);
    layer.addChild(b.renderObject);
    layer.addChild(c.renderObject);

    system.update();

    // After update, zIndex matches each sprite's y. Pixi's render
    // pipeline will then sort by zIndex; we verify the contract by
    // invoking sortChildren manually (mirrors the mock's pixi-render
    // behavior).
    expect(a.renderObject.zIndex).toBe(30);
    expect(b.renderObject.zIndex).toBe(10);
    expect(c.renderObject.zIndex).toBe(20);

    layer.sortChildren();
    expect(layer.children).toEqual([
      b.renderObject,
      c.renderObject,
      a.renderObject,
    ]);
  });

  it("re-writes zIndex when positions change between frames", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const layer = tree.get("characters").container;

    const a = spawnSpriteAt(scene, "a", 10);
    const b = spawnSpriteAt(scene, "b", 20);
    layer.addChild(a.renderObject);
    layer.addChild(b.renderObject);

    system.update();
    expect(a.renderObject.zIndex).toBe(10);
    expect(b.renderObject.zIndex).toBe(20);

    // a walks south past b.
    scene.findEntity("a")!.get(Transform).setPosition(0, 50);

    system.update();
    expect(a.renderObject.zIndex).toBe(50);
    expect(b.renderObject.zIndex).toBe(20);
  });

  it("does not touch zIndex on layers without a sort fn", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0 });
    const layer = tree.get("characters").container;

    const a = spawnSpriteAt(scene, "a", 30);
    layer.addChild(a.renderObject);
    a.zIndex = 999;

    system.update();
    expect(a.renderObject.zIndex).toBe(999);
    expect(a.zIndex).toBe(999);
  });

  it("keys a visual at its y plus its sortOffset", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const tree1 = spawnSpriteAt(scene, "tree", 10);
    const hero = spawnSpriteAt(scene, "hero", 40);
    tree1.setLayer("characters");
    hero.setLayer("characters");
    tree1.sortOffset = 96;

    system.update();
    expect(tree1.renderObject.zIndex).toBe(106);
    expect(hero.renderObject.zIndex).toBe(40);
  });

  it("hands a custom depth key the entity that draws the child", () => {
    const { scene, tree, system } = setup();
    const seen: (string | undefined)[] = [];
    const sort: LayerSortFn = (item) => {
      seen.push(item.entity?.name);
      return item.x;
    };
    tree.ensureLayer({ name: "characters", order: 0, sort });
    const a = spawnSpriteAt(scene, "a", 0);
    a.setLayer("characters");
    tree
      .get("characters")
      .container.addChild(new mocks.MockContainer() as never);

    system.update();
    expect(seen).toEqual(["a", undefined]);
  });

  it("restores a visual's zIndex when it leaves a sorted layer", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    tree.ensureLayer({ name: "props", order: 1 });
    const a = spawnSpriteAt(scene, "a", 300);
    a.setLayer("characters");
    system.update();
    expect(a.renderObject.zIndex).toBe(300);

    a.setLayer("props");
    expect(a.renderObject.zIndex).toBe(0);
  });

  it("gives visuals back their zIndex when the layer stops sorting", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const a = spawnSpriteAt(scene, "a", 300);
    a.setLayer("characters");
    system.update();
    expect(a.renderObject.zIndex).toBe(300);

    tree.get("characters").setSort(undefined);
    expect(a.renderObject.zIndex).toBe(0);
  });

  it("warns once when zIndex is set on a sorted layer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { scene, tree } = setup();
      tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
      const a = spawnSpriteAt(scene, "a", 0);
      a.setLayer("characters");
      a.zIndex = 5;
      a.zIndex = 6;
      const zIndexWarnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes("zIndex"),
      );
      expect(zIndexWarnings).toHaveLength(1);
      expect(String(zIndexWarnings[0]![0])).toContain('layer "characters"');
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects a non-finite zIndex or sortOffset", () => {
    const { scene } = setup();
    const a = spawnSpriteAt(scene, "a", 0);
    expect(() => {
      a.zIndex = Number.NaN;
    }).toThrow("SpriteComponent.zIndex: value must be finite, got NaN.");
    expect(() => {
      a.sortOffset = Number.POSITIVE_INFINITY;
    }).toThrow("SpriteComponent.sortOffset: value must be finite");
  });

  it("flips sortableChildren on a layer with a depth-key fn", () => {
    const { tree } = setup();
    tree.ensureLayer({ name: "characters", order: 0, sort: ySort });
    const layer = tree.get("characters").container;
    expect(layer.sortableChildren).toBe(true);
  });
});
