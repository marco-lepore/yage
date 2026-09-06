import { describe, expect, it, vi } from "vitest";

// The same Pixi-faithful container mock `SortGroupComponent.test.ts` uses:
// `addChild` detaches the child from its previous parent, which is what makes
// a move between layers observable rather than a duplicate.
const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set() {} };
    scale = { x: 1, y: 1, set() {} };
    rotation = 0;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    visible = true;
    destroyed = false;
    eventMode = "passive";

    addChild(child: MockContainer): MockContainer {
      child.parent?.removeChild(child);
      this.children.push(child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const index = this.children.indexOf(child);
      if (index !== -1) {
        this.children.splice(index, 1);
        child.parent = null;
      }
      return child;
    }
    removeChildren(): MockContainer[] {
      const removed = [...this.children];
      for (const child of removed) this.removeChild(child);
      return removed;
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
    static from(texture: unknown): MockSprite {
      const sprite = new MockSprite();
      sprite.texture = texture;
      return sprite;
    }
  }

  return { mocks: { MockContainer, MockSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
}));

import { Transform, Vec2 } from "@yagejs/core";
import { SpriteComponent } from "./SpriteComponent.js";
import { SortGroupComponent } from "./SortGroupComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

describe("VisualComponent.setLayer", () => {
  it("moves the render object from one layer's container to another", () => {
    const { scene, tree } = createRendererTestContext();
    tree.ensureLayer({ name: "bg", order: -10 });
    tree.ensureLayer({ name: "props", order: 10 });
    const entity = spawnEntityInScene(scene, "crate");
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const sprite = entity.add(
      new SpriteComponent({ texture: {} as never, layer: "bg" }),
    );
    expect(tree.get("bg").container.children).toContain(sprite.sprite);

    sprite.setLayer("props");

    expect(sprite.layerName).toBe("props");
    expect(tree.get("bg").container.children).not.toContain(sprite.sprite);
    expect(tree.get("props").container.children).toContain(sprite.sprite);
  });

  it("records the name and moves nothing while the object is out of the tree", () => {
    const { scene, tree } = createRendererTestContext();
    tree.ensureLayer({ name: "props", order: 10 });
    const entity = spawnEntityInScene(scene, "crate");
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const sprite = new SpriteComponent({ texture: {} as never });

    sprite.setLayer("props");
    expect(sprite.layerName).toBe("props");
    expect(sprite.sprite.parent).toBeNull();

    entity.add(sprite);
    expect(tree.get("props").container.children).toContain(sprite.sprite);
  });

  it("re-resolves through the sort group that owns the new layer", () => {
    const { scene, tree } = createRendererTestContext();
    tree.ensureLayer({ name: "props", order: 10 });
    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 0) }));
    knight.add(new SortGroupComponent({ layer: "props" }));
    const sprite = knight.add(new SpriteComponent({ texture: {} as never }));
    expect(tree.defaultLayer.container.children).toContain(sprite.sprite);

    sprite.setLayer("props");

    const group = knight.get(SortGroupComponent).container;
    expect(group.children).toContain(sprite.sprite);
    expect(tree.get("props").container.children).not.toContain(sprite.sprite);
  });

  it("does nothing when the name is the one it already has", () => {
    const { scene, tree } = createRendererTestContext();
    const entity = spawnEntityInScene(scene, "crate");
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const sprite = entity.add(new SpriteComponent({ texture: {} as never }));
    // A second visual after it, so re-adding the first would move it from
    // index 0 to index 1 rather than leaving it where it was.
    const later = spawnEntityInScene(scene, "barrel");
    later.add(new Transform({ position: new Vec2(0, 0) }));
    later.add(new SpriteComponent({ texture: {} as never }));
    const before = tree.defaultLayer.container.children.indexOf(sprite.sprite);
    expect(before).toBe(0);

    sprite.setLayer("default");

    // Re-adding would put it last, which on a layer with no sort is a change
    // of draw order.
    expect(tree.defaultLayer.container.children.indexOf(sprite.sprite)).toBe(
      before,
    );
  });
});
