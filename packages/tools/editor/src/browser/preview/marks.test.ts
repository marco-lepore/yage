import { describe, expect, it, vi } from "vitest";

const { MockContainer, MockSprite } = vi.hoisted(() => {
  class Container {
    children: Container[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    pivot = { x: 0, y: 0 };
    visible = true;
    parent: Container | null = null;
    label = "";

    /** What {@link getLocalBounds} answers; a test sets it directly. */
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

import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";
import {
  MARK_OFFSET_PIXELS,
  MARK_SPACING_PIXELS,
  markKindOf,
  marksOf,
  placedMarks,
  pressesMark,
} from "./marks.js";

/**
 * A component named the way the engine's own invisible ones are, so the
 * editor's table is exercised through the same route a real light takes: the
 * class name.
 */
class LightSource extends Component {}

/** A subclass of a known one, which inherits its drawing. */
class Torch extends LightSource {}

/** A game's own component, which the editor has no drawing for. */
class Chime extends Component {}

function entityWith(components: readonly Component[]): Entity {
  return {
    get: (Type: abstract new (...args: never[]) => Component) =>
      components.find((component) => component instanceof Type),
    getAll: () => components,
    parent: null,
  } as unknown as Entity;
}

describe("markKindOf", () => {
  it("draws the engine's invisible components as what they are", () => {
    expect(markKindOf("UISurface")).toBe("ui");
    expect(markKindOf("UIRoot")).toBe("ui");
    expect(markKindOf("ParticleEmitterComponent")).toBe("particles");
    expect(markKindOf("LightSource")).toBe("light");
    expect(markKindOf("LightOccluder")).toBe("occluder");
  });

  it("gives anything else the generic drawing", () => {
    expect(markKindOf("Chime")).toBe("other");
  });
});

describe("marksOf", () => {
  it("marks a component the preview draws nothing for", () => {
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0) }),
      new LightSource(),
    ]);

    expect(marksOf(entity)).toEqual([{ type: "LightSource", kind: "light" }]);
  });

  it("leaves out the visuals, which are already on screen", () => {
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0) }),
      new SpriteComponent({ texture: {} as never }),
    ]);

    expect(marksOf(entity)).toEqual([]);
  });

  it("marks nothing when the placement has a rectangle of its own", () => {
    const sprite = new SpriteComponent({ texture: {} as never });
    (
      sprite.renderObject as unknown as {
        localBounds: { x: number; y: number; width: number; height: number };
      }
    ).localBounds = { x: -8, y: -8, width: 16, height: 16 };
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0) }),
      sprite,
      new LightSource(),
    ]);

    // The artwork already says the placement is there and where it is, which
    // is the whole of what a mark offers.
    expect(marksOf(entity)).toEqual([]);
  });

  it("marks the same components once the rectangle is gone", () => {
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0) }),
      new LightSource(),
    ]);

    expect(marksOf(entity)).toEqual([{ type: "LightSource", kind: "light" }]);
  });

  it("leaves out the transform, which the editor shows everywhere else", () => {
    const entity = entityWith([new Transform({ position: new Vec2(0, 0) })]);

    expect(marksOf(entity)).toEqual([]);
  });

  it("marks a game's own component under its class name", () => {
    const entity = entityWith([new Chime()]);

    expect(marksOf(entity)).toEqual([{ type: "Chime", kind: "other" }]);
  });

  it("gives a subclass of a known component that component's drawing", () => {
    const entity = entityWith([new Torch()]);

    expect(marksOf(entity)).toEqual([{ type: "Torch", kind: "light" }]);
  });

  it("orders by class name, so a row never reshuffles", () => {
    const added = entityWith([new LightSource(), new Chime()]);
    const other = entityWith([new Chime(), new LightSource()]);

    expect(marksOf(added).map((mark) => mark.type)).toEqual([
      "Chime",
      "LightSource",
    ]);
    expect(marksOf(other)).toEqual(marksOf(added));
  });
});

describe("placedMarks", () => {
  const marks = [
    { type: "LightSource", kind: "light" },
    { type: "ParticleEmitterComponent", kind: "particles" },
  ] as const;

  it("lays one mark out above the origin", () => {
    expect(placedMarks([marks[0]], { x: 40, y: 10 }, 1)).toEqual([
      { ...marks[0], at: { x: 40, y: 10 - MARK_OFFSET_PIXELS } },
    ]);
  });

  it("centres a row on the origin at constant screen spacing", () => {
    const placed = placedMarks(marks, { x: 0, y: 0 }, 1);

    expect(placed.map((mark) => mark.at.x)).toEqual([
      -MARK_SPACING_PIXELS / 2,
      MARK_SPACING_PIXELS / 2,
    ]);
    expect(placed.every((mark) => mark.at.y === -MARK_OFFSET_PIXELS)).toBe(
      true,
    );
  });

  it("keeps the row the same size on screen however far the view is zoomed", () => {
    const close = placedMarks(marks, { x: 0, y: 0 }, 4);

    expect(close.map((mark) => mark.at)).toEqual([
      { x: -MARK_SPACING_PIXELS * 2, y: -MARK_OFFSET_PIXELS * 4 },
      { x: MARK_SPACING_PIXELS * 2, y: -MARK_OFFSET_PIXELS * 4 },
    ]);
  });
});

describe("pressesMark", () => {
  it("takes a press inside the mark's own square", () => {
    expect(pressesMark({ x: 0, y: 0 }, { x: 8, y: -8 }, 1)).toBe(true);
  });

  it("leaves a press past it to whatever is behind", () => {
    expect(pressesMark({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)).toBe(false);
  });

  it("measures in screen pixels, so a zoomed-out mark keeps its target", () => {
    expect(pressesMark({ x: 0, y: 0 }, { x: 30, y: 0 }, 4)).toBe(true);
    expect(pressesMark({ x: 0, y: 0 }, { x: 40, y: 0 }, 4)).toBe(false);
  });

  it("divides the row between neighbours, leaving no gap", () => {
    const placed = placedMarks(
      [
        { type: "A", kind: "other" },
        { type: "B", kind: "other" },
      ],
      { x: 0, y: 0 },
      1,
    );
    // The point exactly between the two: each takes it, so a press there
    // reaches a mark rather than falling through the row.
    const between = { x: 0, y: -MARK_OFFSET_PIXELS };

    expect(placed.map((mark) => pressesMark(mark.at, between, 1))).toEqual([
      true,
      true,
    ]);
  });
});
