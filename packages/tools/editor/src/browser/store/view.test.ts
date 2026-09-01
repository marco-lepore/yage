import { describe, expect, it } from "vitest";
import { DEFAULT_STEP, MAX_STEP, MIN_STEP } from "./snap.js";
import type { EditorPoint, EditorViewState } from "./types.js";
import {
  DEFAULT_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizedView,
  pannedView,
  parseView,
  resetView,
  serializeView,
  toggledGuides,
  toggledSnap,
  viewStorageKey,
  withStep,
  zoomedViewAt,
} from "./view.js";

/** A view with the grid settings spelled out only where a test is about them. */
function viewOf(
  parts: Partial<EditorViewState> & Pick<EditorViewState, "center" | "zoom">,
): EditorViewState {
  return { guides: true, snap: true, step: DEFAULT_STEP, ...parts };
}

/**
 * Where the anchor ends up on screen, in rendered pixels from the middle of
 * the viewport. "Zoom at the pointer" is the claim that this does not move.
 */
function screenOffset(view: EditorViewState, anchor: EditorPoint): EditorPoint {
  return {
    x: (anchor.x - view.center.x) * view.zoom,
    y: (anchor.y - view.center.y) * view.zoom,
  };
}

describe("pannedView", () => {
  it("moves the centre and leaves everything else", () => {
    const view = pannedView(viewOf({ center: { x: 10, y: -4 }, zoom: 2 }), {
      x: 5,
      y: 5,
    });

    expect(view).toEqual(viewOf({ center: { x: 15, y: 1 }, zoom: 2 }));
  });
});

describe("zoomedViewAt", () => {
  it("keeps the anchored world point where it was on screen", () => {
    const before = viewOf({ center: { x: 40, y: -20 }, zoom: 1.5 });
    const anchor = { x: 120, y: 60 };

    const after = zoomedViewAt(before, 1.8, anchor);

    expect(after.zoom).toBeCloseTo(2.7, 12);
    expect(screenOffset(after, anchor).x).toBeCloseTo(
      screenOffset(before, anchor).x,
      9,
    );
    expect(screenOffset(after, anchor).y).toBeCloseTo(
      screenOffset(before, anchor).y,
      9,
    );
  });

  it("holds the anchor at the zoom limit rather than sliding past it", () => {
    const before = viewOf({ center: { x: 0, y: 0 }, zoom: MAX_ZOOM });
    const anchor = { x: 300, y: 300 };

    const after = zoomedViewAt(before, 4, anchor);

    expect(after.zoom).toBe(MAX_ZOOM);
    // The clamped zoom is what the new centre is derived from, so a gesture
    // that cannot magnify further also does not drift.
    expect(after.center).toEqual(before.center);
  });

  it("clamps in both directions", () => {
    const view = viewOf({ center: { x: 0, y: 0 }, zoom: 1 });

    expect(zoomedViewAt(view, 1000, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomedViewAt(view, 0.00001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
  });

  it("returns to the view it started from when the gesture is reversed", () => {
    const before = viewOf({ center: { x: -30, y: 12 }, zoom: 1 });
    const anchor = { x: 90, y: -45 };

    const after = zoomedViewAt(zoomedViewAt(before, 1.4, anchor), 1 / 1.4, {
      x: 90,
      y: -45,
    });

    expect(after.zoom).toBeCloseTo(before.zoom, 12);
    expect(after.center.x).toBeCloseTo(before.center.x, 9);
    expect(after.center.y).toBeCloseTo(before.center.y, 9);
  });
});

describe("normalizedView", () => {
  it("brings an out-of-range zoom inside the bounds", () => {
    expect(
      normalizedView(
        viewOf({ center: { x: 1, y: 2 }, zoom: 500, guides: false }),
      ),
    ).toEqual(
      viewOf({ center: { x: 1, y: 2 }, zoom: MAX_ZOOM, guides: false }),
    );
  });

  it("brings an out-of-range step inside the bounds", () => {
    expect(
      normalizedView(viewOf({ center: { x: 0, y: 0 }, zoom: 1, step: 0.01 }))
        .step,
    ).toBe(MIN_STEP);
    expect(
      normalizedView(viewOf({ center: { x: 0, y: 0 }, zoom: 1, step: 1e9 }))
        .step,
    ).toBe(MAX_STEP);
  });

  it("returns the same view when there is nothing to clamp", () => {
    const view = viewOf({ center: { x: 1, y: 2 }, zoom: 3 });

    expect(normalizedView(view)).toBe(view);
  });
});

describe("parseView", () => {
  it("reads back what it wrote", () => {
    const view = viewOf({
      center: { x: 12.5, y: -3 },
      zoom: 2,
      guides: false,
      snap: false,
      step: 16,
    });

    expect(parseView(serializeView(view))).toEqual(view);
  });

  it("clamps a stored zoom from outside the bounds", () => {
    expect(
      parseView(
        '{"center":{"x":0,"y":0},"zoom":9999,"guides":true,"snap":true,"step":32}',
      )?.zoom,
    ).toBe(MAX_ZOOM);
  });

  it("clamps a stored step from outside the bounds", () => {
    expect(
      parseView(
        '{"center":{"x":0,"y":0},"zoom":1,"guides":true,"snap":true,"step":0.25}',
      )?.step,
    ).toBe(MIN_STEP);
  });

  it.each([
    ["nothing stored", null],
    ["not JSON", "{"],
    ["not an object", "7"],
    ["no centre", '{"zoom":1,"guides":true,"snap":true,"step":32}'],
    [
      "a centre that is not a point",
      '{"center":"origin","zoom":1,"guides":true,"snap":true,"step":32}',
    ],
    [
      "a coordinate that is not a number",
      '{"center":{"x":"0","y":0},"zoom":1,"guides":true,"snap":true,"step":32}',
    ],
    [
      "an infinite coordinate",
      '{"center":{"x":1e999,"y":0},"zoom":1,"guides":true,"snap":true,"step":32}',
    ],
    ["no zoom", '{"center":{"x":0,"y":0},"guides":true,"snap":true,"step":32}'],
    [
      "a zoom of zero",
      '{"center":{"x":0,"y":0},"zoom":0,"guides":true,"snap":true,"step":32}',
    ],
    [
      "a negative zoom",
      '{"center":{"x":0,"y":0},"zoom":-2,"guides":true,"snap":true,"step":32}',
    ],
    // A view stored before the guides existed. It reads as nothing stored:
    // the cost is one remembered camera, and the alternative is a defaulting
    // branch that is dead the moment every stored view has the field.
    [
      "no guides flag",
      '{"center":{"x":0,"y":0},"zoom":1,"snap":true,"step":32}',
    ],
    [
      "a guides flag that is not a boolean",
      '{"center":{"x":0,"y":0},"zoom":1,"guides":"yes","snap":true,"step":32}',
    ],
    // A view stored before snapping existed, read the same way.
    [
      "no snap flag",
      '{"center":{"x":0,"y":0},"zoom":1,"guides":true,"step":32}',
    ],
    [
      "a snap flag that is not a boolean",
      '{"center":{"x":0,"y":0},"zoom":1,"guides":true,"snap":1,"step":32}',
    ],
    ["no step", '{"center":{"x":0,"y":0},"zoom":1,"guides":true,"snap":true}'],
    [
      "a step of zero",
      '{"center":{"x":0,"y":0},"zoom":1,"guides":true,"snap":true,"step":0}',
    ],
    [
      "a negative step",
      '{"center":{"x":0,"y":0},"zoom":1,"guides":true,"snap":true,"step":-8}',
    ],
    [
      "an infinite step",
      '{"center":{"x":0,"y":0},"zoom":1,"guides":true,"snap":true,"step":1e999}',
    ],
  ])("reads %s as nothing stored", (_case, raw) => {
    expect(parseView(raw)).toBeUndefined();
  });
});

describe("viewStorageKey", () => {
  it("separates two projects holding the same level path", () => {
    const path = "levels/forest.yage-level.json";

    expect(viewStorageKey("a", path)).not.toBe(viewStorageKey("b", path));
  });
});

describe("toggledGuides", () => {
  it("switches the guides and leaves the camera", () => {
    const view = viewOf({ center: { x: 8, y: -2 }, zoom: 3 });

    const after = toggledGuides(view);

    expect(after).toEqual(
      viewOf({ center: { x: 8, y: -2 }, zoom: 3, guides: false }),
    );
    expect(toggledGuides(after).guides).toBe(true);
  });
});

describe("toggledSnap", () => {
  it("switches snapping and leaves the guides and the step", () => {
    const view = viewOf({ center: { x: 8, y: -2 }, zoom: 3, step: 16 });

    const after = toggledSnap(view);

    expect(after).toEqual(
      viewOf({ center: { x: 8, y: -2 }, zoom: 3, step: 16, snap: false }),
    );
    expect(toggledSnap(after).snap).toBe(true);
  });
});

describe("withStep", () => {
  it("resizes the lattice and clamps what it is given", () => {
    const view = viewOf({ center: { x: 0, y: 0 }, zoom: 1 });

    expect(withStep(view, 64).step).toBe(64);
    expect(withStep(view, 0).step).toBe(MIN_STEP);
    expect(withStep(view, 1e12).step).toBe(MAX_STEP);
  });
});

describe("resetView", () => {
  it("puts the camera back and keeps the grid settings as they were", () => {
    const view = viewOf({
      center: { x: 400, y: 90 },
      zoom: 6,
      guides: false,
      snap: false,
      step: 10,
    });

    expect(resetView(view)).toEqual(
      viewOf({
        center: { x: 0, y: 0 },
        zoom: 1,
        guides: false,
        snap: false,
        step: 10,
      }),
    );
  });
});

describe("DEFAULT_VIEW", () => {
  it("is the origin, unzoomed, showing its guides and landing on them", () => {
    expect(DEFAULT_VIEW).toEqual({
      center: { x: 0, y: 0 },
      zoom: 1,
      guides: true,
      snap: true,
      step: DEFAULT_STEP,
    });
  });
});
