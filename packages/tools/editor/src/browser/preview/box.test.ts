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
import type { EditorPoint, HandleId } from "../store/index.js";
import { GRAB_PIXELS, HANDLE_PIXELS } from "./gizmo.js";
import {
  BAND_MISS_PIXELS,
  MIN_BOX_PIXELS,
  TURN_BAND_PIXELS,
  boxHandleAt,
  boxHandleDirection,
  boxHandles,
  coveringBox,
  cornerAt,
  inflated,
  nearBox,
  boxAround,
  boxReferences,
  orientedBoxOf,
  SUBSTITUTE_BOX,
  type OrientedBox,
} from "./box.js";

/** Every grip a box can offer, for the cases that are not about which ones it does. */
const ALL_GRIPS: readonly HandleId[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

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

/** A box two hundred by a hundred at the origin, square to the world. */
const UPRIGHT: OrientedBox = {
  center: { x: 0, y: 0 },
  axisX: { x: 1, y: 0 },
  axisY: { x: 0, y: 1 },
  halfX: 100,
  halfY: 50,
};

describe("orientedBoxOf", () => {
  it("covers an unrotated visual, around its position", () => {
    const entity = entityWith([
      new Transform({ position: new Vec2(100, 50) }),
      visualOf({ x: -20, y: -10, width: 40, height: 20 }),
    ]);

    expect(orientedBoxOf(entity)).toEqual({
      center: { x: 100, y: 50 },
      axisX: { x: 1, y: 0 },
      axisY: { x: -0, y: 1 },
      halfX: 20,
      halfY: 10,
    });
  });

  it("turns with the placement instead of boxing it upright", () => {
    const entity = entityWith([
      new Transform({ rotation: Math.PI / 2 }),
      visualOf({ x: -20, y: -10, width: 40, height: 20 }),
    ]);

    const box = orientedBoxOf(entity);
    // A quarter turn puts the box's own x axis along the world's y. The
    // extents stay with their own axes rather than being swapped into an
    // upright rectangle.
    expect(box?.axisX.x).toBeCloseTo(0, 9);
    expect(box?.axisX.y).toBeCloseTo(1, 9);
    expect(box?.halfX).toBeCloseTo(20, 9);
    expect(box?.halfY).toBeCloseTo(10, 9);
  });

  it("puts the box on the visual, not on the origin", () => {
    // A sprite drawn entirely to one side of its own origin — an anchor at a
    // corner. The box has to sit where the picture is.
    const entity = entityWith([
      new Transform({ position: new Vec2(0, 0) }),
      visualOf({ x: 0, y: 0, width: 40, height: 20 }),
    ]);

    expect(orientedBoxOf(entity)?.center).toEqual({ x: 20, y: 10 });
  });

  it("grows with the placement's scale, and a mirror covers the same area", () => {
    const scaled = (x: number): OrientedBox | undefined =>
      orientedBoxOf(
        entityWith([
          new Transform({ scale: new Vec2(x, 3) }),
          visualOf({ x: -20, y: -10, width: 40, height: 20 }),
        ]),
      );

    expect(scaled(2)?.halfX).toBeCloseTo(40, 9);
    expect(scaled(2)?.halfY).toBeCloseTo(30, 9);
    // A negative scale mirrors the picture; it does not move the rectangle it
    // covers, so the extent is the magnitude.
    expect(scaled(-2)?.halfX).toBeCloseTo(40, 9);
  });

  it("has no box for a placement that draws nothing", () => {
    expect(orientedBoxOf(entityWith([new Transform()]))).toBeUndefined();
  });
});

describe("boxReferences", () => {
  const AT_ORIGIN = { position: { x: 0, y: 0 }, rotation: 0 };

  it("measures a selection's grips against the box as drawn", () => {
    // No one placement's artwork under a box round several, so a drag changes
    // the frame's own size by a fraction of itself.
    const references = boxReferences(UPRIGHT, AT_ORIGIN, undefined);

    expect(references.get("e")).toEqual({ x: 100, y: 0, kind: "length" });
    expect(references.get("nw")).toEqual({ x: -100, y: -50, kind: "length" });
    expect(references.size).toBe(8);
  });

  it("measures one placement's grips against its artwork at a scale of one", () => {
    const sides = { least: { x: -8, y: -4 }, most: { x: 8, y: 4 } };
    // A box drawn at four times that size still divides by the artwork, so a
    // drag sets the scale rather than multiplying it.
    const references = boxReferences(
      { ...UPRIGHT, halfX: 32, halfY: 16 },
      AT_ORIGIN,
      sides,
    );

    expect(references.get("se")).toEqual({ x: 8, y: 4, kind: "extent" });
    expect(references.get("w")).toEqual({ x: -8, y: 0, kind: "extent" });
    expect(references.size).toBe(8);
  });

  it("offers no grip for a side sitting on the anchor", () => {
    // A sprite drawn out from its origin: its `w` and `n` sides run through
    // the point the scale turns about, and no scale moves a side sitting
    // there. The grips that are left are the ones that can move.
    const sides = { least: { x: 0, y: 0 }, most: { x: 64, y: 64 } };

    const references = boxReferences(UPRIGHT, AT_ORIGIN, sides);

    expect([...references.keys()]).toEqual(["e", "se", "s"]);
  });

  it("swaps the sides a mirrored placement's grips hold", () => {
    // The drawn box takes the magnitude of the scale, so the side at the
    // higher coordinate is the artwork's lower one once it is mirrored.
    const sides = { least: { x: 64, y: -4 }, most: { x: 0, y: 4 } };

    const references = boxReferences(UPRIGHT, AT_ORIGIN, sides);

    // The grips that acted on the origin side are `e`, `ne` and `se` now.
    expect([...references.keys()]).toEqual(["nw", "n", "s", "sw", "w"]);
    expect(references.get("w")).toEqual({ x: 64, y: 0, kind: "extent" });
  });
});

describe("boxAround", () => {
  it("gives a placement that draws nothing a rectangle to take up room with", () => {
    const box = boxAround(entityWith([new Transform()]));

    expect(box.halfX).toBe(SUBSTITUTE_BOX.maxX);
    expect(box.halfY).toBe(SUBSTITUTE_BOX.maxY);
  });

  it("uses the placement's own rectangle when it has one", () => {
    const entity = entityWith([
      new Transform(),
      visualOf({ x: -20, y: -10, width: 40, height: 20 }),
    ]);

    expect(boxAround(entity).halfX).toBe(20);
  });
});

describe("boxHandles", () => {
  it("puts eight handles on the box's own sides", () => {
    const handles = boxHandles(UPRIGHT, ALL_GRIPS);
    const at = (id: HandleId): EditorPoint | undefined =>
      handles.find((handle) => handle.id === id)?.at;

    expect(handles).toHaveLength(8);
    expect(at("nw")).toEqual({ x: -100, y: -50 });
    expect(at("n")).toEqual({ x: 0, y: -50 });
    expect(at("se")).toEqual({ x: 100, y: 50 });
    expect(at("w")).toEqual({ x: -100, y: 0 });
  });

  it("follows a turned box round rather than staying upright", () => {
    const turned: OrientedBox = {
      ...UPRIGHT,
      axisX: { x: 0, y: 1 },
      axisY: { x: -1, y: 0 },
    };

    const corner = cornerAt(turned, { x: 1, y: -1 });
    // The corner at the box's own (+x, -y) is a quarter turn round from where
    // an upright box would put it.
    expect(corner.x).toBeCloseTo(50, 9);
    expect(corner.y).toBeCloseTo(100, 9);
  });
});

describe("inflated", () => {
  it("leaves a box that is already large enough on screen", () => {
    expect(inflated(UPRIGHT, 1)).toEqual(UPRIGHT);
  });

  it("grows a box that would be too small to put handles on", () => {
    const tiny: OrientedBox = { ...UPRIGHT, halfX: 1, halfY: 1 };

    const grown = inflated(tiny, 1);

    expect(grown.halfX).toBe(MIN_BOX_PIXELS / 2);
    expect(grown.halfY).toBe(MIN_BOX_PIXELS / 2);
    // Symmetrically, so each handle stays on the side it is named for.
    expect(grown.center).toEqual(tiny.center);
  });

  it("measures the minimum on screen, not in the world", () => {
    const tiny: OrientedBox = { ...UPRIGHT, halfX: 1, halfY: 1 };

    // Ten world units to the screen pixel: the same box needs ten times the
    // world to cover the same pixels.
    expect(inflated(tiny, 10).halfX).toBe((MIN_BOX_PIXELS / 2) * 10);
  });

  it("keeps the handles apart at the minimum, and the middle clear", () => {
    const grown = inflated({ ...UPRIGHT, halfX: 0, halfY: 0 }, 1);
    const handles = boxHandles(grown, ALL_GRIPS);
    const away = (from: EditorPoint, to: EditorPoint): number =>
      Math.hypot(from.x - to.x, from.y - to.y);

    // Adjacent handles along one edge, so the nearer one wins from the
    // tolerance away rather than from less.
    const corner = cornerAt(grown, { x: -1, y: -1 });
    const edge = cornerAt(grown, { x: 0, y: -1 });
    expect(away(corner, edge) / 2).toBeGreaterThanOrEqual(GRAB_PIXELS);

    // And the middle of the box is further from every handle than a press on
    // one reaches, so the interior stays grabbable for a move.
    const reach = GRAB_PIXELS + HANDLE_PIXELS / 2;
    for (const handle of handles) {
      expect(away(grown.center, handle.at)).toBeGreaterThan(reach);
    }
  });
});

describe("boxHandleAt", () => {
  it("gives each side and corner its own handle", () => {
    expect(boxHandleAt(UPRIGHT, ALL_GRIPS, 1, { x: -100, y: -50 })).toBe("nw");
    expect(boxHandleAt(UPRIGHT, ALL_GRIPS, 1, { x: 0, y: 50 })).toBe("s");
    expect(boxHandleAt(UPRIGHT, ALL_GRIPS, 1, { x: 100, y: 0 })).toBe("e");
  });

  it("moves from the interior and turns from the band outside", () => {
    expect(boxHandleAt(UPRIGHT, ALL_GRIPS, 1, { x: 0, y: 0 })).toBe("body");
    expect(
      boxHandleAt(UPRIGHT, ALL_GRIPS, 1, { x: 0, y: -50 - TURN_BAND_PIXELS }),
    ).toBe("turn");
  });

  it("finds nothing past the band", () => {
    expect(
      boxHandleAt(UPRIGHT, ALL_GRIPS, 1, {
        x: 0,
        y: -50 - TURN_BAND_PIXELS - 1,
      }),
    ).toBeNull();
  });

  it("prefers a handle to the interior and to the band", () => {
    // Just inside the top edge, next to the middle handle. Both the interior
    // and the handle cover it; the handle is what is drawn there.
    expect(boxHandleAt(UPRIGHT, ALL_GRIPS, 1, { x: 0, y: -48 })).toBe("n");
    // And just outside the same edge, where the band also covers it.
    expect(boxHandleAt(UPRIGHT, ALL_GRIPS, 1, { x: 0, y: -52 })).toBe("n");
  });

  it("reads a turned box in the box's own frame", () => {
    const turned: OrientedBox = {
      ...UPRIGHT,
      axisX: { x: 0, y: 1 },
      axisY: { x: -1, y: 0 },
    };

    // The box's own `e` side is a quarter turn round from the world's.
    expect(boxHandleAt(turned, ALL_GRIPS, 1, { x: 0, y: 100 })).toBe("e");
    expect(boxHandleAt(turned, ALL_GRIPS, 1, { x: 100, y: 0 })).toBeNull();
  });
});

describe("the turn band against the handles", () => {
  it("stays reachable outside a handle on the smallest box there is", () => {
    // The worst case in the whole design: a placement small enough to be
    // drawn at the minimum, where the handles are as close together as they
    // ever get, probed straight out from the handle that reaches furthest
    // into the band.
    const box = inflated({ ...UPRIGHT, halfX: 0, halfY: 0 }, 1);
    const handle = cornerAt(box, { x: 0, y: -1 });
    const at = (beyond: number): HandleId | null =>
      boxHandleAt(box, ALL_GRIPS, 1, { x: handle.x, y: handle.y - beyond });

    const reach = GRAB_PIXELS + HANDLE_PIXELS / 2;
    let widest = 0;
    for (let beyond = reach; beyond <= TURN_BAND_PIXELS; beyond += 0.1) {
      if (at(beyond) === "turn") widest += 0.1;
    }

    // Wide enough to aim at. Anything under about ten pixels here is the
    // small-target problem again, one region further out.
    expect(widest).toBeGreaterThan(15);
  });

  it("gives the whole band to the turn away from the handles", () => {
    // A long box, where the handles along one edge are far apart. Halfway
    // between two of them the band is its full width.
    const long: OrientedBox = { ...UPRIGHT, halfX: 400, halfY: 100 };
    const between = { x: -200, y: -100 - TURN_BAND_PIXELS + 0.5 };

    expect(boxHandleAt(long, ALL_GRIPS, 1, between)).toBe("turn");
  });
});

/**
 * How far a press can stray from `spot` along `direction` and still read as
 * `want`, in screen pixels.
 */
function reachOf(
  box: OrientedBox,
  want: HandleId | null,
  spot: EditorPoint,
  direction: EditorPoint,
  perScreenPixel: number,
): number {
  let held = 0;
  let past = 400;
  for (let step = 0; step < 60; step += 1) {
    const middle = (held + past) / 2;
    const at = {
      x: spot.x + direction.x * middle * perScreenPixel,
      y: spot.y + direction.y * middle * perScreenPixel,
    };
    if (boxHandleAt(box, ALL_GRIPS, perScreenPixel, at) === want) held = middle;
    else past = middle;
  }
  return held;
}

/**
 * The box measured in the pixels the pointer moves in. `perScreenPixel`
 * carries both the camera's zoom and the scale a fit draws the canvas at.
 */
describe("the box, in screen pixels", () => {
  for (const zoom of [0.05, 1, 20]) {
    for (const canvasScale of [1, 760 / 1280]) {
      const perScreenPixel = 1 / (zoom * canvasScale);
      const label = `zoom ${String(zoom)}, canvas ×${canvasScale.toFixed(3)}`;
      // A box large enough at every zoom that the minimum never applies, so
      // these measure the handles rather than the inflation.
      const box: OrientedBox = {
        ...UPRIGHT,
        halfX: 400 * perScreenPixel,
        halfY: 200 * perScreenPixel,
      };

      it(`reaches every handle by the same distance at ${label}`, () => {
        const expected = GRAB_PIXELS + HANDLE_PIXELS / 2;
        for (const handle of boxHandles(box, ALL_GRIPS)) {
          const outward = {
            x: handle.at.x === 0 ? 0 : Math.sign(handle.at.x),
            y: handle.at.y === 0 ? 0 : Math.sign(handle.at.y),
          };
          const length = Math.hypot(outward.x, outward.y);
          const away = reachOf(
            box,
            handle.id,
            handle.at,
            { x: outward.x / length, y: outward.y / length },
            perScreenPixel,
          );
          expect([handle.id, Number(away.toFixed(4))]).toEqual([
            handle.id,
            Number(expected.toFixed(4)),
          ]);
        }
      });

      it(`turns out to ${String(TURN_BAND_PIXELS)} pixels outside the box at ${label}`, () => {
        // Out from the middle of an edge. The handle sitting there owns the
        // first stretch, then the band, and past the band nothing.
        const at = (beyond: number): HandleId | null =>
          boxHandleAt(box, ALL_GRIPS, perScreenPixel, {
            x: 0,
            y: -box.halfY - beyond * perScreenPixel,
          });

        expect(at(GRAB_PIXELS + HANDLE_PIXELS / 2 + 1)).toBe("turn");
        expect(at(TURN_BAND_PIXELS - 0.01)).toBe("turn");

        // The band's outer edge, found rather than assumed.
        let held = GRAB_PIXELS + HANDLE_PIXELS / 2 + 1;
        let past = 400;
        for (let step = 0; step < 60; step += 1) {
          const middle = (held + past) / 2;
          if (at(middle) !== null) held = middle;
          else past = middle;
        }
        expect(held).toBeCloseTo(TURN_BAND_PIXELS, 4);
      });

      it(`keeps the selection ${String(BAND_MISS_PIXELS)} pixels out at ${label}`, () => {
        const just = (beyond: number): EditorPoint => ({
          x: 0,
          y: -box.halfY - beyond * perScreenPixel,
        });

        // A hair inside the boundary rather than exactly on it: the distance
        // is a square root of scaled world units, so the last bit is noise.
        expect(
          nearBox(box, perScreenPixel, just(BAND_MISS_PIXELS - 0.01)),
        ).toBe(true);
        expect(nearBox(box, perScreenPixel, just(BAND_MISS_PIXELS + 1))).toBe(
          false,
        );
      });
    }
  }
});

describe("boxHandleDirection", () => {
  it("points a side handle along the box's own axis", () => {
    expect(boxHandleDirection(UPRIGHT, "e")).toEqual({ x: 1, y: 0 });
    expect(boxHandleDirection(UPRIGHT, "w")).toEqual({ x: -1, y: 0 });
    expect(boxHandleDirection(UPRIGHT, "s")).toEqual({ x: 0, y: 1 });
    expect(boxHandleDirection(UPRIGHT, "n")).toEqual({ x: 0, y: -1 });
  });

  it("gives a corner the diagonal the box actually has", () => {
    // 200 by 100, so its corner leans towards the long axis rather than
    // sitting at 45 degrees.
    const corner = boxHandleDirection(UPRIGHT, "se");
    expect(corner?.x ?? 0).toBeGreaterThan(corner?.y ?? 0);
    expect(Math.hypot(corner?.x ?? 0, corner?.y ?? 0)).toBeCloseTo(1, 12);
  });

  it("turns with the placement", () => {
    // A quarter turn: the handle on the box's own east side now points down
    // the screen, which is what decides the cursor over it.
    const turned: OrientedBox = {
      ...UPRIGHT,
      axisX: { x: 0, y: 1 },
      axisY: { x: -1, y: 0 },
    };

    const east = boxHandleDirection(turned, "e");
    expect(east?.x ?? 1).toBeCloseTo(0, 12);
    expect(east?.y ?? 0).toBeCloseTo(1, 12);
  });

  it("gives the interior and the turn band no direction", () => {
    // Neither holds a side: a move goes wherever the pointer does, and a turn
    // goes round.
    expect(boxHandleDirection(UPRIGHT, "body")).toBeUndefined();
    expect(boxHandleDirection(UPRIGHT, "turn")).toBeUndefined();
  });
});

describe("coveringBox", () => {
  it("holds two upright boxes in one", () => {
    const right: OrientedBox = { ...UPRIGHT, center: { x: 300, y: 0 } };

    const covering = coveringBox([UPRIGHT, right], 0);

    // From the left one's near edge to the right one's far edge.
    expect(covering?.center).toEqual({ x: 150, y: 0 });
    expect(covering?.halfX).toBe(250);
    expect(covering?.halfY).toBe(50);
  });

  it("returns a lone box unchanged, along its own axes", () => {
    const covering = coveringBox([UPRIGHT], 0);

    expect(covering?.center.x).toBeCloseTo(0, 9);
    expect(covering?.halfX).toBeCloseTo(UPRIGHT.halfX, 9);
    expect(covering?.halfY).toBeCloseTo(UPRIGHT.halfY, 9);
  });

  it("measures a turned box by its corners, not its upright bounds", () => {
    // A 200-by-100 box turned a quarter: along the world axes it is 100 wide
    // and 200 tall, which is what its corners say and what its own extents do
    // not.
    const turned: OrientedBox = {
      ...UPRIGHT,
      axisX: { x: 0, y: 1 },
      axisY: { x: -1, y: 0 },
    };

    const covering = coveringBox([turned], 0);

    expect(covering?.halfX).toBeCloseTo(50, 9);
    expect(covering?.halfY).toBeCloseTo(100, 9);
  });

  it("lies along the axes it is given", () => {
    // The same turned box measured along its own axes is its own size again.
    const turned: OrientedBox = {
      ...UPRIGHT,
      axisX: { x: 0, y: 1 },
      axisY: { x: -1, y: 0 },
    };

    const covering = coveringBox([turned], Math.PI / 2);

    expect(covering?.halfX).toBeCloseTo(100, 9);
    expect(covering?.halfY).toBeCloseTo(50, 9);
  });

  it("covers a placement that draws nothing by its substitute rectangle", () => {
    const substitute: OrientedBox = {
      center: { x: 400, y: 200 },
      axisX: { x: 1, y: 0 },
      axisY: { x: 0, y: 1 },
      halfX: SUBSTITUTE_BOX.maxX,
      halfY: SUBSTITUTE_BOX.maxY,
    };
    const covering = coveringBox([UPRIGHT, substitute], 0);

    expect(covering?.center).toEqual({ x: 158, y: 83 });
    expect(covering?.halfX).toBe(258);
    expect(covering?.halfY).toBe(133);
  });

  it("has nothing to cover when nothing is given", () => {
    expect(coveringBox([], 0)).toBeUndefined();
  });
});
