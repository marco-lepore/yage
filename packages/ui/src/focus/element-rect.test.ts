import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { readElementRect } from "./element-rect.js";
import type { Rect } from "../positioning.js";
import type { UIElement } from "../types.js";

/**
 * One container of a chain: where it sits in its parent, its scale, its
 * rotation in radians, and the pivot it turns about.
 */
interface Link {
  x?: number;
  y?: number;
  sx?: number;
  sy?: number;
  rotation?: number;
  pivotX?: number;
  pivotY?: number;
}

/** Nest one container per link, host first; the last one is the element's. */
function chain(links: readonly Link[]): { host: Container; box: Container } {
  let host: Container | undefined;
  let box: Container | undefined;
  for (const link of links) {
    const next = new Container();
    next.position.set(link.x ?? 0, link.y ?? 0);
    next.scale.x = link.sx ?? 1;
    next.scale.y = link.sy ?? link.sx ?? 1;
    next.rotation = link.rotation ?? 0;
    next.pivot.set(link.pivotX ?? 0, link.pivotY ?? 0);
    box?.addChild(next);
    host ??= next;
    box = next;
  }
  if (host === undefined || box === undefined) throw new Error("empty chain");
  return { host, box };
}

/** A stand-in element: a container to project, and a laid-out Yoga size. */
function makeElement(
  container: Container,
  width: number,
  height: number,
): UIElement {
  return {
    displayObject: container,
    yogaNode: {
      getComputedWidth: () => width,
      getComputedHeight: () => height,
    } as unknown as UIElement["yogaNode"],
    visible: true,
    update: () => undefined,
    destroy: () => undefined,
  };
}

function emptyRect(): Rect {
  return { x: -1, y: -1, width: -1, height: -1 };
}

describe("readElementRect", () => {
  // The element's own transform and every ancestor's are both part of the box
  // it is drawn in.
  it.each<[string, Link[], [number, number], Rect]>([
    [
      "projects a nested element into the host's own space",
      [
        { x: 100, y: 200 },
        { x: 10, y: 20 },
        { x: 5, y: 5 },
      ],
      [40, 20],
      { x: 15, y: 25, width: 40, height: 20 },
    ],
    [
      "carries the element's own scale",
      [{}, { x: 200, y: 100, sx: 2 }],
      [100, 40],
      { x: 200, y: 100, width: 200, height: 80 },
    ],
    [
      "scales about the pivot the element turns on",
      [{}, { x: 60, y: 70, sx: 2, pivotX: 20, pivotY: 10 }],
      [40, 20],
      { x: 20, y: 50, width: 80, height: 40 },
    ],
    [
      "scales the projected box by a scaled ancestor",
      [{}, { x: 10, y: 20, sx: 2 }, { x: 5, y: 5 }],
      [40, 20],
      { x: 20, y: 30, width: 80, height: 40 },
    ],
    [
      "follows the scroll offset its parent container carries",
      [{}, {}, { y: -140 }, { y: 80 }],
      [100, 30],
      { x: 0, y: -60, width: 100, height: 30 },
    ],
    [
      "reads a box in the host's own space wherever the host is placed",
      [
        { x: 340, y: 210, sx: 1.5 },
        { x: 12, y: 48, sx: 2 },
      ],
      [80, 24],
      { x: 12, y: 48, width: 160, height: 48 },
    ],
    [
      "normalises the corners under a mirrored ancestor",
      [{}, { sx: -1, sy: 1 }, {}],
      [40, 20],
      { x: -40, y: 0, width: 40, height: 20 },
    ],
  ])("%s", (_name, links, [width, height], expected) => {
    const { host, box } = chain(links);

    const out = emptyRect();
    expect(readElementRect(host, makeElement(box, width, height), out)).toBe(
      true,
    );
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(out[key]).toBeCloseTo(expected[key]);
    }
  });

  it("takes the box around all four corners of a rotated element", () => {
    // A 40 x 20 box turned a quarter about its centre covers 20 x 40.
    const { host, box } = chain([
      {},
      { x: 60, y: 70, rotation: Math.PI / 2, pivotX: 20, pivotY: 10 },
    ]);

    const out = emptyRect();
    expect(readElementRect(host, makeElement(box, 40, 20), out)).toBe(true);
    expect(out.x).toBeCloseTo(50);
    expect(out.y).toBeCloseTo(50);
    expect(out.width).toBeCloseTo(20);
    expect(out.height).toBeCloseTo(40);
  });

  it.each<[string, Link[]]>([
    ["a host scaled to 0", [{ sx: 0 }, { x: 10, y: 10 }]],
    ["a container scaled to 0 below the host", [{}, { sx: 0 }, { x: 10 }]],
    ["an element scaled to 0", [{}, { x: 60, sx: 0, pivotX: 20 }]],
    ["an element flattened on one axis", [{}, { sx: 1, sy: 0 }]],
    [
      "an element flattened on one axis and rotated",
      [{}, { sx: 1, sy: 0, rotation: Math.PI / 4 }],
    ],
    [
      "a flattened container below a turned and scaled host",
      [{ rotation: 0.3, sx: 1.7 }, { sx: 1, sy: 0 }, { rotation: 0.9 }],
    ],
  ])(
    "reports an element drawn with no area under %s and leaves the rect alone",
    (_name, links) => {
      const { host, box } = chain(links);

      const out = emptyRect();
      expect(readElementRect(host, makeElement(box, 40, 20), out)).toBe(false);
      expect(out).toEqual(emptyRect());
    },
  );

  it("reports a node that never laid out and leaves the rect alone", () => {
    const { host, box } = chain([{}, {}]);

    const out = emptyRect();
    for (const [width, height] of [
      [Number.NaN, 20],
      [40, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(readElementRect(host, makeElement(box, width, height), out)).toBe(
        false,
      );
    }
    expect(out).toEqual(emptyRect());
  });
});
