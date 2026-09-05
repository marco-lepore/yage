import { describe, expect, it, vi } from "vitest";

const { MockContainer, MockSprite } = vi.hoisted(() => {
  class Container {
    children: Container[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    pivot = { x: 0, y: 0 };
    visible = true;
    alpha = 1;
    tint = 0xffffff;
    blendMode = "inherit";
    eventMode = "passive";
    parent: Container | null = null;
    label = "";
    /** What {@link getLocalBounds} answers; a test sets it through `withBounds`. */
    localBounds = { x: 0, y: 0, width: 0, height: 0 };

    getLocalBounds(): { x: number; y: number; width: number; height: number } {
      return this.localBounds;
    }

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
import {
  FRAME_MARGIN,
  containsPoint,
  framedView,
  worldBoundsOf,
} from "./bounds.js";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sprite whose render object reports the given rectangle in local space. */
function visualOf(bounds: Rect): SpriteComponent {
  const visual = new SpriteComponent({ texture: {} as never });
  // The mock render object holds its rectangle in a field the real one does
  // not have, so the assignment goes through the mock's own shape.
  (visual.renderObject as unknown as { localBounds: Rect }).localBounds =
    bounds;
  return visual;
}

function entityWith(components: readonly Component[]): Entity {
  return {
    get: (Type: abstract new (...args: never[]) => Component) =>
      components.find((component) => component instanceof Type),
    getAll: () => components,
    parent: null,
  } as unknown as Entity;
}

describe("worldBoundsOf", () => {
  it("reports an unrotated visual's rectangle around its position", () => {
    const entity = entityWith([
      new Transform({ position: new Vec2(100, 50) }),
      visualOf({ x: -20, y: -10, width: 40, height: 20 }),
    ]);

    expect(worldBoundsOf(entity)).toEqual({
      minX: 80,
      minY: 40,
      maxX: 120,
      maxY: 60,
    });
  });

  it("takes the scale into account", () => {
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0), scale: new Vec2(2, 3) }),
      visualOf({ x: -10, y: -10, width: 20, height: 20 }),
    ]);

    expect(worldBoundsOf(entity)).toEqual({
      minX: -20,
      minY: -30,
      maxX: 20,
      maxY: 30,
    });
  });

  it("grows a rotated rectangle to what it actually covers", () => {
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0), rotation: Math.PI / 4 }),
      visualOf({ x: -10, y: -10, width: 20, height: 20 }),
    ]);

    const bounds = worldBoundsOf(entity);

    // A square turned 45 degrees needs its diagonal, not its side. Rotating
    // the rectangle in place and keeping its extents would answer ±10.
    const half = Math.SQRT2 * 10;
    expect(bounds?.minX).toBeCloseTo(-half, 9);
    expect(bounds?.maxX).toBeCloseTo(half, 9);
    expect(bounds?.minY).toBeCloseTo(-half, 9);
    expect(bounds?.maxY).toBeCloseTo(half, 9);
  });

  it("covers every visual on the entity", () => {
    const entity = entityWith([
      new Transform(),
      visualOf({ x: 0, y: 0, width: 10, height: 10 }),
      visualOf({ x: -30, y: 5, width: 10, height: 10 }),
    ]);

    expect(worldBoundsOf(entity)).toEqual({
      minX: -30,
      minY: 0,
      maxX: 10,
      maxY: 15,
    });
  });

  it("takes the render object's pivot into account", () => {
    const visual = visualOf({ x: -10, y: -10, width: 20, height: 20 });
    (
      visual.renderObject as unknown as { pivot: { x: number; y: number } }
    ).pivot = { x: 5, y: 0 };
    const entity = entityWith([
      new Transform({ position: new Vec2(100, 0) }),
      visual,
    ]);

    // The renderer draws at `position + R·S·(point - pivot)`, so the box sits
    // five units left of where the position alone would put it.
    expect(worldBoundsOf(entity)).toEqual({
      minX: 85,
      minY: -10,
      maxX: 105,
      maxY: 10,
    });
  });

  it("reports nothing for an entity that draws nothing", () => {
    expect(worldBoundsOf(entityWith([new Transform()]))).toBeUndefined();
  });
});

describe("framedView", () => {
  it("centres the rectangle and zooms so it fits with a margin", () => {
    const view = framedView(
      { center: { x: 0, y: 0 }, zoom: 1, guides: true, snap: true, step: 32 },
      { minX: 100, minY: 0, maxX: 300, maxY: 100 },
      { width: 800, height: 600 },
    );

    expect(view.center).toEqual({ x: 200, y: 50 });
    // Width is the tighter of the two: 800 / (200 * 1.2) against
    // 600 / (100 * 1.2). The margin is spelled out rather than taken from
    // `FRAME_MARGIN`, which would make any value of it pass.
    expect(view.zoom).toBeCloseTo(800 / (200 * 1.2), 12);
    expect(FRAME_MARGIN).toBe(1.2);
  });

  it("frames a rectangle with no size at a finite zoom", () => {
    const view = framedView(
      { center: { x: 0, y: 0 }, zoom: 1, guides: true, snap: true, step: 32 },
      { minX: 7, minY: 7, maxX: 7, maxY: 7 },
      { width: 800, height: 600 },
    );

    expect(view.center).toEqual({ x: 7, y: 7 });
    expect(Number.isFinite(view.zoom)).toBe(true);
  });

  it("leaves the guides as the view had them", () => {
    const view = framedView(
      { center: { x: 0, y: 0 }, zoom: 1, guides: false, snap: true, step: 32 },
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { width: 800, height: 600 },
    );

    expect(view.guides).toBe(false);
  });
});

describe("containsPoint", () => {
  it("shifts the box by the pivot, the way the drawing is shifted", () => {
    const visual = visualOf({ x: -10, y: -10, width: 20, height: 20 });
    (
      visual.renderObject as unknown as { pivot: { x: number; y: number } }
    ).pivot = { x: 5, y: 0 };
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0) }),
      visual,
    ]);

    // The box covers -15..5, so its old right edge is outside it and its new
    // left edge is inside.
    expect(containsPoint(entity, { x: -14, y: 0 })).toBe(true);
    expect(containsPoint(entity, { x: 9, y: 0 })).toBe(false);
  });

  it("finds a point inside a scaled, rotated visual", () => {
    const entity = entityWith([
      new Transform({
        position: new Vec2(100, 0),
        rotation: Math.PI / 2,
        scale: new Vec2(2, 1),
      }),
      visualOf({ x: -10, y: -2, width: 20, height: 4 }),
    ]);

    // The visual is 40 by 4 before the quarter turn, 4 by 40 after it.
    expect(containsPoint(entity, { x: 100, y: 18 })).toBe(true);
    expect(containsPoint(entity, { x: 118, y: 0 })).toBe(false);
  });
});
