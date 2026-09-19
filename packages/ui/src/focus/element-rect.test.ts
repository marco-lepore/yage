import { describe, expect, it } from "vitest";
import { readElementRect } from "./element-rect.js";
import { MockContainer } from "../test-helpers.js";
import type { Rect } from "../positioning.js";
import type { DisplayContainer } from "@yagejs/renderer";
import type { UIElement } from "../types.js";

/** One container of a chain: where it sits in its parent, and its scale. */
interface Link {
  x?: number;
  y?: number;
  sx?: number;
  sy?: number;
}

/** Nest one container per link, host first; the last one is the element's. */
function chain(links: readonly Link[]): {
  host: DisplayContainer;
  box: MockContainer;
} {
  let host: MockContainer | undefined;
  let box: MockContainer | undefined;
  for (const link of links) {
    const next = new MockContainer();
    next.position.set(link.x ?? 0, link.y ?? 0);
    next.scale.x = link.sx ?? 1;
    next.scale.y = link.sy ?? link.sx ?? 1;
    box?.addChild(next);
    host ??= next;
    box = next;
  }
  if (host === undefined || box === undefined) throw new Error("empty chain");
  return { host: host as unknown as DisplayContainer, box };
}

/** A stand-in element: a container to project, and a laid-out Yoga size. */
function makeElement(
  container: MockContainer,
  width: number,
  height: number,
): UIElement {
  return {
    displayObject: container as unknown as DisplayContainer,
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
  // `applyLayout` sizes a sprite by scale, so an element's own scale is not
  // part of its layout box; every ancestor's scale and offset is.
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
      "reads the layout box of an element its own scale sizes",
      [{}, { x: 200, y: 100, sx: 2 }],
      [100, 40],
      { x: 200, y: 100, width: 100, height: 40 },
    ],
    [
      "reads a picture's box at its box, not at its texture's aspect",
      [{}, { sx: 100 / 64, sy: 40 / 64 }],
      [100, 40],
      { x: 0, y: 0, width: 100, height: 40 },
    ],
    [
      "magnifies a self-scaled element by its ancestors and not by itself",
      [{}, { x: 10, y: 20, sx: 2 }, { x: 5, y: 5, sx: 3 }],
      [30, 12],
      { x: 20, y: 30, width: 60, height: 24 },
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
      "keeps a self-scaled row's box on the scroll offset it is drawn at",
      [{}, {}, { y: -140 }, { y: 80, sx: 2 }],
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
      { x: 12, y: 48, width: 80, height: 24 },
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
    expect(out).toEqual(expected);
  });

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
