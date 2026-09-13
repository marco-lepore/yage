import { outlineContains } from "./geometry.js";
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

import { Transform, Vec2, Component, Engine, type Entity } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";
import {
  FRAME_MARGIN,
  containsPoint,
  framedView,
  worldBoundsOf,
} from "./bounds.js";

import type { ColliderFacetSnapshot } from "@yagejs/physics";

class Footprint extends Component {
  constructor(public facet: ColliderFacetSnapshot) {
    super();
  }
}
const inspector = new Engine().inspector;
inspector.registerFacetContributor({
  namespace: "collider",
  inspectComponent: (component) =>
    component instanceof Footprint ? component.facet : undefined,
});
const box = (
  x: number,
  y: number,
  width: number,
  height: number,
  sensor = false,
) =>
  new Footprint({
    sensor,
    outlines: [
      {
        closed: true,
        vertices: [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ],
      },
    ],
  });

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

describe("contributed collider footprints", () => {
  it("uses one footprint for area picking and bounds, following edits immediately", () => {
    const transform = new Transform({ position: new Vec2(40, 60) });
    const footprint = box(0, 0, 100, 20);
    const entity = entityWith([transform, footprint]);
    expect(worldBoundsOf(entity, inspector)).toEqual({
      minX: 40,
      minY: 60,
      maxX: 140,
      maxY: 80,
    });
    expect(containsPoint(entity, { x: 130, y: 70 }, 1, inspector)).toBe(true);
    expect(containsPoint(entity, { x: 30, y: 70 }, 1, inspector)).toBe(false);
    transform.setPosition(100, 120);
    footprint.facet = box(0, 0, 200, 40).facet;
    expect(worldBoundsOf(entity, inspector)).toEqual({
      minX: 100,
      minY: 120,
      maxX: 300,
      maxY: 160,
    });
  });

  it("preserves artwork priority and falls back when artwork is empty", () => {
    const visual = visualOf({ x: 0, y: 0, width: 10, height: 10 });
    const entity = entityWith([
      new Transform(),
      visual,
      box(-50, -50, 100, 100),
    ]);
    expect(worldBoundsOf(entity, inspector)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    });
    expect(containsPoint(entity, { x: 40, y: 0 }, 1, inspector)).toBe(false);
    (visual.renderObject as unknown as { localBounds: Rect }).localBounds = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    expect(worldBoundsOf(entity, inspector)).toEqual({
      minX: -50,
      minY: -50,
      maxX: 50,
      maxY: 50,
    });
  });

  it("keeps gaps and unfilled corners outside compound hit targets", () => {
    const footprint = box(-40, -10, 20, 20, true);
    footprint.facet = {
      sensor: true,
      outlines: [
        ...footprint.facet.outlines,
        {
          closed: true,
          vertices: [
            { x: 20, y: 0 },
            { x: 30, y: -10 },
            { x: 40, y: 0 },
            { x: 30, y: 10 },
          ],
        },
      ],
    };
    const entity = entityWith([new Transform(), footprint]);
    expect(worldBoundsOf(entity, inspector)).toEqual({
      minX: -40,
      minY: -10,
      maxX: 40,
      maxY: 10,
    });
    expect(containsPoint(entity, { x: 0, y: 0 }, 1, inspector)).toBe(false);
    expect(containsPoint(entity, { x: -30, y: 0 }, 1, inspector)).toBe(true);
    expect(containsPoint(entity, { x: 39, y: 9 }, 1, inspector)).toBe(false);
  });

  it("composes contributed offsets with mirrored, rotated parent transforms", () => {
    const parentTransform = new Transform({
      position: new Vec2(50, 100),
      rotation: Math.PI / 2,
      scale: new Vec2(-2, 3),
    });
    const parent = entityWith([parentTransform]);
    const transform = new Transform({ position: new Vec2(10, 0) });
    const entity = entityWith([transform, box(0, 0, 10, 20)]);
    Object.assign(parent, {
      tryGet: () => parentTransform,
      children: new Map([["child", entity]]),
    });
    Object.assign(entity, {
      parent,
      children: new Map(),
      tryGet: () => transform,
    });
    parentTransform.entity = parent;
    transform.entity = entity;
    const before = worldBoundsOf(entity, inspector)!;
    expect(before.minX).toBeCloseTo(-10);
    expect(before.maxX).toBeCloseTo(50);
    expect(before.minY).toBeCloseTo(60);
    expect(before.maxY).toBeCloseTo(80);
    parentTransform.setPosition(80, 140);
    expect(worldBoundsOf(entity, inspector)?.minX).toBeCloseTo(20);
    expect(worldBoundsOf(entity, inspector)?.maxY).toBeCloseTo(120);
  });

  it("picks open polylines only near segments, using screen pixels at each zoom", () => {
    const entity = entityWith([
      new Transform(),
      new Footprint({
        sensor: false,
        outlines: [
          {
            closed: false,
            vertices: [
              { x: 0, y: 0 },
              { x: 0, y: 40 },
              { x: 40, y: 40 },
            ],
          },
        ],
      }),
    ]);
    expect(containsPoint(entity, { x: 20, y: 20 }, 1, inspector)).toBe(false);
    expect(containsPoint(entity, { x: 3, y: 20 }, 1, inspector)).toBe(true);
    expect(containsPoint(entity, { x: 6, y: 20 }, 2, inspector)).toBe(true);
    expect(containsPoint(entity, { x: 6, y: 20 }, 1, inspector)).toBe(false);
  });
});

describe("collapsed collider hit targets", () => {
  it.each([0, 0.7, 2.4])(
    "keeps a screen-sized target for a closed outline collapsed along one axis at angle %s",
    (angle) => {
      const vertices = [-10, -10, 10, 10].map((y) => ({
        x: -y * Math.sin(angle),
        y: y * Math.cos(angle),
      }));
      const outline = { closed: true, sensor: false, vertices };
      expect(
        outlineContains(
          outline,
          { x: 0.25 * Math.cos(angle), y: 0.25 * Math.sin(angle) },
          4,
        ),
      ).toBe(true);
      expect(
        outlineContains(
          outline,
          { x: 5 * Math.cos(angle), y: 5 * Math.sin(angle) },
          4,
        ),
      ).toBe(false);
    },
  );
});
