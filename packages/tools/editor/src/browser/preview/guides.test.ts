import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM } from "../store/index.js";
import {
  MIN_GRID_PIXELS,
  drawGuides,
  gridLines,
  gridSteps,
  type GuideView,
} from "./guides.js";
import type { OverlayTarget } from "./overlay.js";

/** One drawing call, as the recorder saw it. */
type Call = readonly [string, ...number[]];

/** A `Graphics` reduced to what it was asked to draw. */
function recorder(): OverlayTarget & { calls: Call[] } {
  const calls: Call[] = [];
  const target: OverlayTarget & { calls: Call[] } = {
    calls,
    clear() {
      calls.push(["clear"]);
      return target;
    },
    moveTo(x, y) {
      calls.push(["moveTo", x, y]);
      return target;
    },
    lineTo(x, y) {
      calls.push(["lineTo", x, y]);
      return target;
    },
    rect(x, y, width, height) {
      calls.push(["rect", x, y, width, height]);
      return target;
    },
    circle(x, y, radius) {
      calls.push(["circle", x, y, radius]);
      return target;
    },
    stroke(style) {
      calls.push(["stroke", style.color, style.width]);
      return target;
    },
    fill(style) {
      calls.push(["fill", style.color]);
      return target;
    },
  };
  return target;
}

/** A view of a 1280x720 design size, one world unit to one screen pixel. */
const VIEW: GuideView = {
  world: { minX: -640, minY: -360, maxX: 640, maxY: 360 },
  viewport: { width: 1280, height: 720 },
  perScreenPixel: 1,
  step: 32,
};

/** The lattices a project might work on, from a pixel up to a large room. */
const STEPS = [1, 16, 32, 50, 1000];

/**
 * Every `perScreenPixel` the editor can produce, over the zoom range and the
 * canvas scales a fit draws at — a pane far narrower than the design size
 * through one drawn larger than it.
 */
function everyScale(): number[] {
  const scales: number[] = [];
  for (const canvas of [0.2, 0.359, 0.59375, 1, 2.5, 4]) {
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom *= 1.07) {
      scales.push(1 / zoom / canvas);
    }
    scales.push(1 / MAX_ZOOM / canvas);
  }
  return scales;
}

describe("gridSteps", () => {
  it("draws whole multiples of the lattice, never a fraction of one", () => {
    for (const step of STEPS) {
      for (const perScreenPixel of everyScale()) {
        const { fine, major } = gridSteps(perScreenPixel, step);
        expect(Number.isInteger(fine / step)).toBe(true);
        expect(fine / step).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(major / fine)).toBe(true);
      }
    }
  });

  it("draws the lattice itself once it is wide enough to read", () => {
    for (const step of STEPS) {
      for (const perScreenPixel of everyScale()) {
        if (step / perScreenPixel < MIN_GRID_PIXELS) continue;
        expect(gridSteps(perScreenPixel, step).fine).toBe(step);
      }
    }
  });

  it("keeps the fine lines inside the readable band while it subdivides", () => {
    for (const step of STEPS) {
      for (const perScreenPixel of everyScale()) {
        // Above the floor the lattice is drawn as it stands, however wide that
        // is: nothing finer exists to land on, so there is nothing to draw.
        if (step / perScreenPixel >= MIN_GRID_PIXELS) continue;
        const { fine, major } = gridSteps(perScreenPixel, step);
        const onScreen = fine / perScreenPixel;
        expect(onScreen).toBeGreaterThanOrEqual(MIN_GRID_PIXELS - 1e-9);
        expect(onScreen).toBeLessThan(MIN_GRID_PIXELS * 2.5);
        // A viewport panel is a few hundred pixels across. A major spacing
        // wider than this puts one line on the canvas, usually behind the
        // world axis, and the second grid level buys nothing.
        expect(major / perScreenPixel).toBeLessThan(300);
      }
    }
  });

  it("picks round multiples, four or five fine lines to a major one", () => {
    for (const step of STEPS) {
      for (const perScreenPixel of everyScale()) {
        const { fine, major } = gridSteps(perScreenPixel, step);
        const times = fine / step;
        const decade = 10 ** Math.round(Math.log10(times));
        expect([1, 2, 5]).toContain(Math.round(times / decade));
        expect([4, 5]).toContain(Math.round(major / fine));
        // Exactly, not nearly: a major line that missed a fine one would draw
        // two lines a hair apart.
        expect(major % fine).toBeCloseTo(0, 9);
      }
    }
  });

  it("coarsens as the view zooms out and stops at the lattice going in", () => {
    expect(gridSteps(1, 32).fine).toBe(32);
    expect(gridSteps(10, 32).fine).toBe(320);
    expect(gridSteps(100, 32).fine).toBe(3200);
    // Zoomed in past the lattice there is nothing finer to draw.
    expect(gridSteps(0.1, 32).fine).toBe(32);
  });
});

describe("gridLines", () => {
  it("returns the multiples of the step inside the range", () => {
    expect(gridLines(-100, 100, 50)).toEqual([-100, -50, 0, 50, 100]);
  });

  it("starts at the first multiple inside a range that misses one", () => {
    expect(gridLines(-99, 99, 50)).toEqual([-50, 0, 50]);
  });

  it("stays exact across a range far from the origin", () => {
    const lines = gridLines(999_950, 1_000_150, 50);
    expect(lines).toEqual([
      999_950, 1_000_000, 1_000_050, 1_000_100, 1_000_150,
    ]);
  });

  it("returns nothing for a range holding no multiple", () => {
    expect(gridLines(1, 49, 50)).toEqual([]);
  });
});

describe("drawGuides", () => {
  it("draws the default viewport at the design size, centred on the origin", () => {
    const target = recorder();
    drawGuides(target, VIEW);
    const rects = target.calls.filter((call) => call[0] === "rect");
    expect(rects).not.toHaveLength(0);
    for (const rect of rects)
      expect(rect).toEqual(["rect", -640, -360, 1280, 720]);
  });

  it("puts the axes at zero however far the view has moved", () => {
    const target = recorder();
    drawGuides(target, {
      ...VIEW,
      world: { minX: 4000, minY: 2000, maxX: 5280, maxY: 2720 },
    });
    // The axes are the only lines drawn at exactly zero on one coordinate,
    // since the world rectangle here holds neither.
    const horizontal = target.calls.filter(
      (call) => call[0] === "moveTo" && call[2] === 0,
    );
    const vertical = target.calls.filter(
      (call) => call[0] === "moveTo" && call[1] === 0,
    );
    expect(horizontal).toHaveLength(1);
    expect(vertical).toHaveLength(1);
  });

  it("draws the viewport rectangle whether or not it is in view", () => {
    const target = recorder();
    drawGuides(target, {
      ...VIEW,
      world: { minX: 4000, minY: 2000, maxX: 5280, maxY: 2720 },
    });
    expect(
      target.calls.some(
        (call) => call[0] === "rect" && call[1] === -640 && call[2] === -360,
      ),
    ).toBe(true);
  });

  it("clears before drawing, so a moved view leaves nothing behind", () => {
    const target = recorder();
    drawGuides(target, VIEW);
    expect(target.calls[0]).toEqual(["clear"]);
  });

  it("keeps every stroke one screen pixel wide as the view zooms out", () => {
    const target = recorder();
    drawGuides(target, { ...VIEW, perScreenPixel: 8 });
    const widths = new Set(
      target.calls
        .filter((call) => call[0] === "stroke")
        .map((call) => call[2]),
    );
    // One pixel for the grid, two for the axes and the viewport box, and the
    // casing under the box at twice that.
    expect([...widths].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      8, 16, 32,
    ]);
  });

  it("draws a bounded number of lines at the widest view", () => {
    const target = recorder();
    // The whole zoom range out, on the narrowest canvas scale: the widest
    // world rectangle the editor can show.
    const perScreenPixel = 1 / MIN_ZOOM / 0.2;
    const halfWidth = (1280 / 2) * perScreenPixel;
    const halfHeight = (720 / 2) * perScreenPixel;
    drawGuides(target, {
      world: {
        minX: -halfWidth,
        minY: -halfHeight,
        maxX: halfWidth,
        maxY: halfHeight,
      },
      viewport: { width: 1280, height: 720 },
      perScreenPixel,
      step: 32,
    });
    const lines = target.calls.filter((call) => call[0] === "lineTo").length;
    // At 24 screen pixels apart a 1280-wide canvas holds under 54 vertical
    // lines and 30 horizontal ones, fine and major together.
    expect(lines).toBeLessThan(180);
  });
});
