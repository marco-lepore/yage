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
  openingView,
  resetView,
  serializeView,
  toggledGuides,
  toggledSnap,
  viewAfterResize,
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

describe("viewAfterResize", () => {
  it("holds the world under the viewport's top-left corner", () => {
    const view = viewOf({ center: { x: 10, y: 40 }, zoom: 1 });

    const after = viewAfterResize(
      view,
      { width: 800, height: 600 },
      { width: 800, height: 500 },
    );

    // A hundred pixels off the bottom is fifty world units off the centre, and
    // nothing sideways. Centring instead would slide the level up by fifty.
    expect(after.center).toEqual({ x: 10, y: -10 });
  });

  it("measures the change in world units, so the zoom decides how far", () => {
    const view = viewOf({ center: { x: 0, y: 0 }, zoom: 2 });

    const after = viewAfterResize(
      view,
      { width: 800, height: 600 },
      { width: 800, height: 500 },
    );

    expect(after.center).toEqual({ x: 0, y: -25 });
  });

  it("moves the other way when the pane grows", () => {
    const view = viewOf({ center: { x: 0, y: 0 }, zoom: 1 });

    const after = viewAfterResize(
      view,
      { width: 800, height: 500 },
      { width: 900, height: 600 },
    );

    expect(after.center).toEqual({ x: 50, y: 50 });
  });

  it("carries the zoom and the grid settings", () => {
    const view = viewOf({
      center: { x: 0, y: 0 },
      zoom: 3,
      snap: false,
      step: 8,
    });

    const after = viewAfterResize(
      view,
      { width: 800, height: 600 },
      { width: 800, height: 500 },
    );

    expect(after.zoom).toBe(3);
    expect(after.guides).toBe(true);
    expect(after.snap).toBe(false);
    expect(after.step).toBe(8);
  });

  it("answers the same view when nothing it can act on changed", () => {
    // The caller compares by identity to decide whether to dispatch, so each
    // of these has to be the object it was handed rather than a copy of it.
    const view = viewOf({ center: { x: 10, y: 40 }, zoom: 1 });
    const size = { width: 800, height: 600 };

    expect(viewAfterResize(view, size, { ...size })).toBe(view);
    expect(viewAfterResize(view, size, { width: 800, height: 0 })).toBe(view);
    expect(viewAfterResize(view, { width: 0, height: 600 }, size)).toBe(view);
    expect(
      viewAfterResize(view, size, { width: Number.NaN, height: 600 }),
    ).toBe(view);
    expect(viewAfterResize(view, { width: 800, height: Infinity }, size)).toBe(
      view,
    );
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

  it("frames the game's picture in the pane when one has been measured", () => {
    const view = viewOf({ center: { x: 400, y: 90 }, zoom: 6, step: 10 });

    expect(
      resetView(view, {
        pane: { width: 480, height: 600 },
        design: { width: 960, height: 600 },
      }),
    ).toEqual(viewOf({ center: { x: 0, y: 0 }, zoom: 0.5, step: 10 }));
  });
});

describe("openingView", () => {
  it("fits the design rectangle into the pane on its tighter axis", () => {
    expect(
      openingView({
        pane: { width: 1920, height: 600 },
        design: { width: 960, height: 600 },
      }).zoom,
    ).toBe(1);
    expect(
      openingView({
        pane: { width: 1920, height: 300 },
        design: { width: 960, height: 600 },
      }).zoom,
    ).toBe(0.5);
  });

  it("opens at the world origin, where the design rectangle is centred", () => {
    expect(
      openingView({
        pane: { width: 480, height: 300 },
        design: { width: 960, height: 600 },
      }).center,
    ).toEqual({ x: 0, y: 0 });
  });

  it("keeps the zoom inside the range the wheel is held to", () => {
    expect(
      openingView({
        pane: { width: 100000, height: 100000 },
        design: { width: 1, height: 1 },
      }).zoom,
    ).toBe(MAX_ZOOM);
  });

  it("is the unmeasured default with no pane, and with a pane of no size", () => {
    expect(openingView(undefined)).toBe(DEFAULT_VIEW);
    expect(
      openingView({
        pane: { width: 0, height: 600 },
        design: { width: 960, height: 600 },
      }),
    ).toBe(DEFAULT_VIEW);
    expect(
      openingView({
        pane: { width: 800, height: 600 },
        design: { width: Number.NaN, height: 600 },
      }),
    ).toBe(DEFAULT_VIEW);
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
