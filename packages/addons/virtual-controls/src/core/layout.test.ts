import { describe, expect, it } from "vitest";
import {
  normalizeControlsConfig,
  resolveButtonLayouts,
  resolvePlacement,
  resolveStickLayout,
} from "./layout.js";
import type { ControlZone, ViewportRect } from "./types.js";

const VP: ViewportRect = { x: 0, y: 0, width: 800, height: 600 };

describe("normalizeControlsConfig", () => {
  it("rejects stick + sticks together", () => {
    expect(() => normalizeControlsConfig({ stick: {}, sticks: [{}] })).toThrow(
      "not both",
    );
  });

  it("defaults stick ids and axes by position", () => {
    const { sticks } = normalizeControlsConfig({ sticks: [{}, {}] });
    expect(sticks.map((s) => s.id)).toEqual(["left", "right"]);
    expect(sticks.map((s) => s.axes)).toEqual(["left", "right"]);
  });

  it("gives a defaulted stick the free axes side", () => {
    const { sticks } = normalizeControlsConfig({
      sticks: [{ axes: "right" }, {}],
    });
    expect(sticks[0]?.axes).toBe("right");
    expect(sticks[1]?.axes).toBe("left");
  });

  it("a third stick gets no axes side", () => {
    const { sticks } = normalizeControlsConfig({ sticks: [{}, {}, {}] });
    expect(sticks[2]?.axes).toBe(false);
    expect(sticks[2]?.id).toBe("stick-2");
  });

  it("rejects two sticks on the same explicit axes side", () => {
    expect(() =>
      normalizeControlsConfig({ sticks: [{ axes: "left" }, { axes: "left" }] }),
    ).toThrow("same gamepad axes side");
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      normalizeControlsConfig({ sticks: [{ id: "x" }, { id: "x" }] }),
    ).toThrow('duplicate stick id "x"');
    expect(() =>
      normalizeControlsConfig({
        buttons: [{ id: "a" }, { id: "a" }],
      }),
    ).toThrow('duplicate button id "a"');
  });

  it("rejects out-of-range deadZone / threshold", () => {
    expect(() => normalizeControlsConfig({ stick: { deadZone: 1 } })).toThrow(
      "deadZone",
    );
    expect(() => normalizeControlsConfig({ stick: { threshold: 0 } })).toThrow(
      "threshold",
    );
    expect(() =>
      normalizeControlsConfig({ stick: { deadZone: Number.NaN } }),
    ).toThrow(
      'VirtualControls: stick "left" deadZone must be finite and in [0, 1), got NaN.',
    );
    expect(() =>
      normalizeControlsConfig({
        stick: { threshold: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(
      'VirtualControls: stick "left" threshold must be finite and in (0, 1], got Infinity.',
    );
  });

  it("rejects non-positive radii", () => {
    expect(() => normalizeControlsConfig({ stick: { radius: 0 } })).toThrow(
      "radius",
    );
    expect(() =>
      normalizeControlsConfig({ buttons: [{ id: "a", radius: -5 }] }),
    ).toThrow("radius");
    expect(() =>
      normalizeControlsConfig({ stick: { radius: Number.NaN } }),
    ).toThrow(
      'VirtualControls: stick "left" radius must be finite and > 0, got NaN.',
    );
    expect(() =>
      normalizeControlsConfig({
        buttons: [{ id: "a", radius: Number.POSITIVE_INFINITY }],
      }),
    ).toThrow(
      'VirtualControls: button "a" radius must be finite and > 0, got Infinity.',
    );
  });

  it("rejects malformed placements", () => {
    expect(() =>
      normalizeControlsConfig({
        buttons: [{ id: "a", placement: { left: 10, right: 10, bottom: 5 } }],
      }),
    ).toThrow("exactly one");
    expect(() =>
      normalizeControlsConfig({
        buttons: [{ id: "a", placement: { left: 10 } }],
      }),
    ).toThrow("exactly one");
    expect(() =>
      normalizeControlsConfig({
        buttons: [
          {
            id: "a",
            placement: { left: Number.NaN, top: 10 },
          },
        ],
      }),
    ).toThrow(
      'VirtualControls: placement for button "a" left must be finite, got NaN.',
    );
  });

  it("rejects invalid stick zones", () => {
    expect(() =>
      normalizeControlsConfig({
        stick: {
          zone: { x: 0, y: 0, width: 1 } as unknown as ControlZone,
        },
      }),
    ).toThrow(
      'zone for stick "left" height must be finite and in (0, 1], got undefined',
    );
    expect(() =>
      normalizeControlsConfig({
        stick: { zone: { x: 0, y: 0, width: Number.NaN, height: 1 } },
      }),
    ).toThrow('zone for stick "left" width must be finite and in (0, 1]');
    expect(() =>
      normalizeControlsConfig({
        stick: { zone: { x: 0, y: 0, width: 1, height: 0 } },
      }),
    ).toThrow('zone for stick "left" height must be finite and in (0, 1]');
    for (const zone of [
      { x: -0.1, y: 0, width: 1, height: 1 },
      { x: 0, y: 1.1, width: 1, height: 1 },
      { x: 0, y: 0, width: 1.1, height: 1 },
    ]) {
      expect(() => normalizeControlsConfig({ stick: { zone } })).toThrow(
        "must be finite and in",
      );
    }
    expect(() =>
      normalizeControlsConfig({
        stick: { zone: { x: 1, y: 1, width: 1, height: 1 } },
      }),
    ).not.toThrow();
  });

  it("defaults button labels and slide behavior", () => {
    const { buttons } = normalizeControlsConfig({
      buttons: [{ id: "dash" }],
    });
    expect(buttons[0]?.label).toBe("DASH");
    expect(buttons[0]?.pressOnEnter).toBe(false);
    expect(buttons[0]?.releaseOnLeave).toBe(true);
  });

  it("folds the actions tuple into the object form, null skipping", () => {
    const { sticks } = normalizeControlsConfig({
      stick: { actions: ["l", "r", null, "d"] },
    });
    expect(sticks[0]?.actions).toEqual({ left: "l", right: "r", down: "d" });
    const objForm = normalizeControlsConfig({
      stick: { actions: { left: "l" } },
    });
    expect(objForm.sticks[0]?.actions).toEqual({ left: "l" });
  });

  it("side flips the defaults without geometry config", () => {
    const { sticks } = normalizeControlsConfig({ stick: { side: "right" } });
    expect(sticks[0]?.side).toBe("right");
    expect(sticks[0]?.axes).toBe("right");
    expect(sticks[0]?.id).toBe("right");
    const layout = resolveStickLayout(sticks[0]!, VP);
    expect(layout.center.x).toBeGreaterThan(400);
    expect(layout.zone?.x).toBe(400);
  });

  it("explicit axes wins over side for the mirror, not the geometry", () => {
    const { sticks } = normalizeControlsConfig({
      stick: { side: "right", axes: "left" },
    });
    expect(sticks[0]?.axes).toBe("left");
    expect(sticks[0]?.side).toBe("right");
  });
});

describe("resolvePlacement", () => {
  it("measures from the chosen edges", () => {
    expect(resolvePlacement({ left: 120, bottom: 140 }, VP)).toEqual({
      x: 120,
      y: 460,
    });
    expect(resolvePlacement({ right: 100, top: 40 }, VP)).toEqual({
      x: 700,
      y: 40,
    });
  });

  it("respects the viewport origin (cover/expand fit rects)", () => {
    const vp: ViewportRect = { x: 50, y: 20, width: 700, height: 560 };
    expect(resolvePlacement({ left: 10, top: 10 }, vp)).toEqual({
      x: 60,
      y: 30,
    });
    expect(resolvePlacement({ right: 10, bottom: 10 }, vp)).toEqual({
      x: 740,
      y: 570,
    });
  });
});

describe("resolveStickLayout", () => {
  const stick = (over: object = {}) =>
    normalizeControlsConfig({ stick: over }).sticks[0]!;

  it("defaults radius to 11% of the min viewport side", () => {
    const layout = resolveStickLayout(stick(), VP);
    expect(layout.radius).toBe(66);
  });

  it("floors the derived radius at 1 on a collapsed viewport", () => {
    const layout = resolveStickLayout(stick(), {
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
    expect(layout.radius).toBe(1);
  });

  it("anchors a left stick to the bottom-left corner", () => {
    const layout = resolveStickLayout(stick(), VP);
    expect(layout.center.x).toBeCloseTo(66 * 1.6);
    expect(layout.center.y).toBeCloseTo(600 - 66 * 1.6);
  });

  it("gives a floating stick the bottom 70% of its half", () => {
    const layout = resolveStickLayout(stick(), VP);
    expect(layout.zone).toEqual({ x: 0, y: 180, width: 400, height: 420 });
    const right = resolveStickLayout(stick({ axes: "right" }), VP);
    expect(right.zone?.x).toBe(400);
  });

  it("a fixed stick has no zone rect (grab circle instead)", () => {
    const layout = resolveStickLayout(stick({ mode: "fixed" }), VP);
    expect(layout.zone).toBeUndefined();
  });

  it("honors explicit radius, placement and zone", () => {
    const layout = resolveStickLayout(
      stick({
        radius: 50,
        placement: { right: 90, top: 80 },
        zone: { x: 0.25, y: 0.5, width: 0.5, height: 0.5 },
      }),
      VP,
    );
    expect(layout.radius).toBe(50);
    expect(layout.center).toEqual({ x: 710, y: 80 });
    expect(layout.zone).toEqual({ x: 200, y: 300, width: 400, height: 300 });
  });
});

describe("resolveButtonLayouts", () => {
  const buttons = (n: number, over: object = {}) =>
    normalizeControlsConfig({
      buttons: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, ...over })),
    }).buttons;

  it("defaults radius to 6.5% of the min viewport side", () => {
    const [a] = resolveButtonLayouts(buttons(1), undefined, VP);
    expect(a?.radius).toBe(39);
  });

  it("keeps every auto-placed button inside the viewport", () => {
    for (const n of [1, 2, 3, 4, 6]) {
      for (const l of resolveButtonLayouts(buttons(n), undefined, VP)) {
        expect(l.center.x - l.radius).toBeGreaterThanOrEqual(0);
        expect(l.center.x + l.radius).toBeLessThanOrEqual(800);
        expect(l.center.y - l.radius).toBeGreaterThanOrEqual(0);
        expect(l.center.y + l.radius).toBeLessThanOrEqual(600);
      }
    }
  });

  it("keeps auto-placed buttons from overlapping", () => {
    for (const n of [2, 3, 4, 6]) {
      const layouts = resolveButtonLayouts(buttons(n), undefined, VP);
      for (let i = 0; i < layouts.length; i++) {
        for (let j = i + 1; j < layouts.length; j++) {
          const a = layouts[i]!;
          const b = layouts[j]!;
          const dist = Math.hypot(
            a.center.x - b.center.x,
            a.center.y - b.center.y,
          );
          expect(dist).toBeGreaterThanOrEqual(a.radius + b.radius);
        }
      }
    }
  });

  it("puts the primary of a pair toward the corner", () => {
    const [first, second] = resolveButtonLayouts(buttons(2), undefined, VP);
    expect(first!.center.x).toBeGreaterThan(second!.center.x);
    expect(first!.center.y).toBeGreaterThan(second!.center.y);
  });

  it("arranges four as a diamond: bottom, right, left, top", () => {
    const [a, b, x, y] = resolveButtonLayouts(buttons(4), undefined, VP);
    const centers = [a!, b!, x!, y!].map((l) => l.center);
    const anchorX = (centers[1]!.x + centers[2]!.x) / 2;
    const anchorY = (centers[0]!.y + centers[3]!.y) / 2;
    expect(centers[0]!.y).toBeGreaterThan(anchorY); // A: bottom
    expect(centers[1]!.x).toBeGreaterThan(anchorX); // B: right
    expect(centers[2]!.x).toBeLessThan(anchorX); // X: left
    expect(centers[3]!.y).toBeLessThan(anchorY); // Y: top
  });

  it("honors an explicit placement without disturbing the cluster", () => {
    const cfg = normalizeControlsConfig({
      buttons: [
        { id: "pause", placement: { right: 40, top: 40 } },
        { id: "a" },
        { id: "b" },
      ],
    }).buttons;
    const [pause, a, b] = resolveButtonLayouts(cfg, undefined, VP);
    expect(pause!.center).toEqual({ x: 760, y: 40 });
    // a + b form the 2-slot cluster (primary toward the corner).
    expect(a!.center.x).toBeGreaterThan(b!.center.x);
  });

  it("moves the whole cluster with the `cluster` placement", () => {
    const layouts = resolveButtonLayouts(
      buttons(2),
      { left: 120, bottom: 120 },
      VP,
    );
    for (const l of layouts) {
      expect(l.center.x).toBeLessThan(250);
      expect(l.center.y).toBeGreaterThan(350);
    }
  });

  it("corner keywords mirror the default anchor, keeping the derived inset", () => {
    const base = resolveButtonLayouts(buttons(2), undefined, VP);
    const explicit = resolveButtonLayouts(buttons(2), "bottom-right", VP);
    expect(explicit).toEqual(base);

    const left = resolveButtonLayouts(buttons(2), "bottom-left", VP);
    expect(left[0]!.center.x).toBeCloseTo(800 - base[0]!.center.x);
    expect(left[0]!.center.y).toBeCloseTo(base[0]!.center.y);

    const top = resolveButtonLayouts(buttons(2), "top-right", VP);
    expect(top[0]!.center.x).toBeCloseTo(base[0]!.center.x);
    expect(top[0]!.center.y).toBeCloseTo(600 - base[0]!.center.y);
  });
});
