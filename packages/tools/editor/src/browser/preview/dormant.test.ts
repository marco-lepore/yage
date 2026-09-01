import { describe, expect, it, vi } from "vitest";

const { MockContainer, MockSprite } = vi.hoisted(() => {
  class Container {
    children: Container[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    tint = 0xffffff;
    blendMode = "inherit";
    eventMode = "passive";
    parent: Container | null = null;
    label = "";

    addChild(child: Container): Container {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    removeFromParent(): void {
      this.parent = null;
    }

    destroy(): void {}
  }

  class Sprite extends Container {
    texture: unknown;

    static from(texture: unknown): Sprite {
      const created = new Sprite();
      created.texture = texture;
      return created;
    }
  }

  return { MockContainer: Container, MockSprite: Sprite };
});

vi.mock("pixi.js", () => ({
  Assets: { cache: new Map<string, unknown>() },
  Container: MockContainer,
  Graphics: class Graphics extends MockContainer {},
  Point: class Point {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
  },
  Sprite: MockSprite,
  Texture: class Texture {
    readonly isMockTexture = true;
  },
}));

import { Transform, Vec2, type Component, type Entity } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";
import { synchronizeDormantVisuals } from "./dormant.js";

/**
 * An entity stands in for the three members the pass reads. Composition
 * through a live parent chain is pinned where it belongs, on
 * `DisplaySystem`'s own contract test in the renderer package; what is under
 * test here is which components are written and when they are shown.
 */
function entityWith(
  components: readonly Component[],
  parent: Entity | null = null,
): Entity {
  return {
    get: (Type: abstract new (...args: never[]) => Component) =>
      components.find((component) => component instanceof Type),
    getAll: () => components,
    parent,
  } as unknown as Entity;
}

function sprite(): SpriteComponent {
  return new SpriteComponent({ texture: {} as never });
}

describe("synchronizeDormantVisuals", () => {
  it("writes the transform's world pose onto every visual", () => {
    const transform = new Transform({
      position: new Vec2(30, 40),
      rotation: Math.PI / 4,
      scale: new Vec2(2, 3),
    });
    const visual = sprite();
    const entity = entityWith([transform, visual]);

    synchronizeDormantVisuals([{ entity, authoredActive: true }]);

    expect(visual.renderObject.position).toMatchObject({ x: 30, y: 40 });
    expect(visual.renderObject.rotation).toBeCloseTo(Math.PI / 4);
    expect(visual.renderObject.scale).toMatchObject({ x: 2, y: 3 });
    expect(visual.renderObject.visible).toBe(true);
  });

  it("hides a placement authored inactive", () => {
    const visual = sprite();
    const entity = entityWith([new Transform(), visual]);

    synchronizeDormantVisuals([{ entity, authoredActive: false }]);

    expect(visual.renderObject.visible).toBe(false);
  });

  it("hides the children of a placement authored inactive", () => {
    const parentVisual = sprite();
    const parent = entityWith([new Transform(), parentVisual]);
    const childVisual = sprite();
    const child = entityWith([new Transform(), childVisual], parent);

    synchronizeDormantVisuals([
      { entity: parent, authoredActive: false },
      { entity: child, authoredActive: true },
    ]);

    expect(parentVisual.renderObject.visible).toBe(false);
    expect(childVisual.renderObject.visible).toBe(false);
  });

  it("keeps a child visible under an active parent", () => {
    const parent = entityWith([new Transform(), sprite()]);
    const childVisual = sprite();
    const child = entityWith([new Transform(), childVisual], parent);

    synchronizeDormantVisuals([
      { entity: parent, authoredActive: true },
      { entity: child, authoredActive: true },
    ]);

    expect(childVisual.renderObject.visible).toBe(true);
  });

  it("respects a visual hidden by the game itself", () => {
    const visual = sprite();
    visual.visible = false;
    const entity = entityWith([new Transform(), visual]);

    synchronizeDormantVisuals([{ entity, authoredActive: true }]);

    expect(visual.renderObject.visible).toBe(false);
  });

  it("respects a disabled component", () => {
    const visual = sprite();
    visual.enabled = false;
    const entity = entityWith([new Transform(), visual]);

    synchronizeDormantVisuals([{ entity, authoredActive: true }]);

    expect(visual.renderObject.visible).toBe(false);
  });

  it("ignores components that draw nothing", () => {
    const transform = new Transform({ position: new Vec2(5, 5) });
    const entity = entityWith([transform]);

    expect(() =>
      synchronizeDormantVisuals([{ entity, authoredActive: true }]),
    ).not.toThrow();
  });

  it("ignores an ancestor that is not a placement of this level", () => {
    const outsider = entityWith([new Transform()]);
    const visual = sprite();
    const entity = entityWith([new Transform(), visual], outsider);

    synchronizeDormantVisuals([{ entity, authoredActive: true }]);

    expect(visual.renderObject.visible).toBe(true);
  });
});
