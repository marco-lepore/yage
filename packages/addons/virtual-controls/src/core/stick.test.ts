import { describe, expect, it } from "vitest";
import { normalizeControlsConfig } from "./layout.js";
import { VirtualStick } from "./stick.js";
import type { StickLayout, VirtualStickConfig } from "./types.js";

const LAYOUT: StickLayout = {
  center: { x: 200, y: 400 },
  radius: 100,
  zone: { x: 0, y: 0, width: 400, height: 600 },
};

function makeStick(
  over: VirtualStickConfig = {},
  layout: StickLayout = LAYOUT,
): VirtualStick {
  const cfg = normalizeControlsConfig({ stick: over }).sticks[0];
  if (!cfg) throw new Error("no stick config");
  const stick = new VirtualStick(cfg);
  stick.setLayout(layout);
  return stick;
}

describe("VirtualStick — floating (default)", () => {
  it("hit-tests against the zone rect", () => {
    const s = makeStick();
    expect(s.hitTest(10, 10)).toBe(true);
    expect(s.hitTest(401, 300)).toBe(false);
  });

  it("recenters the base under the touch and starts at zero", () => {
    const s = makeStick();
    s.engage(1, 150, 300);
    expect(s.active).toBe(true);
    expect(s.basePos).toEqual({ x: 150, y: 300 });
    expect(s.value.x).toBe(0);
    expect(s.value.y).toBe(0);
  });

  it("clamps the recentered base into the zone", () => {
    const s = makeStick();
    s.engage(1, 390, 610); // y beyond the 600-tall zone
    expect(s.basePos).toEqual({ x: 390, y: 600 });
  });

  it("rescales deflection across the dead zone", () => {
    const s = makeStick(); // deadZone 0.1
    s.engage(1, 150, 300);
    s.move(200, 300); // raw +0.5 x
    expect(s.rawValue.x).toBeCloseTo(0.5);
    expect(s.value.x).toBeCloseTo((0.5 - 0.1) / 0.9);
    expect(s.value.y).toBe(0);
  });

  it("zeroes inside the dead zone but keeps rawValue", () => {
    const s = makeStick();
    s.engage(1, 150, 300);
    s.move(155, 300); // raw 0.05 < 0.1
    expect(s.value.x).toBe(0);
    expect(s.rawValue.x).toBeCloseTo(0.05);
  });

  it("clamps deflection magnitude to 1", () => {
    const s = makeStick();
    s.engage(1, 150, 300);
    s.move(150 + 500, 300);
    expect(s.rawValue.x).toBe(1);
    expect(s.value.x).toBe(1);
    expect(s.knobPos.x).toBeCloseTo(150 + 100);
  });

  it("uses screen convention: up is negative y", () => {
    const s = makeStick();
    s.engage(1, 150, 300);
    s.move(150, 300 - 90);
    expect(s.value.y).toBeLessThan(0);
    expect(s.digital.up).toBe(true);
    expect(s.digital.down).toBe(false);
  });

  it("release zeroes state and re-anchors the base", () => {
    const s = makeStick();
    s.engage(1, 150, 300);
    s.move(240, 300);
    s.release();
    expect(s.active).toBe(false);
    expect(s.value.x).toBe(0);
    expect(s.digital.right).toBe(false);
    expect(s.basePos).toEqual(LAYOUT.center);
  });
});

describe("VirtualStick — digital hysteresis", () => {
  it("engages at threshold and holds until 75% of it", () => {
    const s = makeStick(); // threshold 0.5 on value
    s.engage(1, 100, 300);
    // value = (raw - 0.1) / 0.9 → raw for value v: raw = v * 0.9 + 0.1
    const rawFor = (v: number) => (v * 0.9 + 0.1) * 100;

    s.move(100 + rawFor(0.49), 300);
    expect(s.digital.right).toBe(false);
    s.move(100 + rawFor(0.51), 300);
    expect(s.digital.right).toBe(true);
    // Dip below threshold but above the release point: still held.
    s.move(100 + rawFor(0.4), 300);
    expect(s.digital.right).toBe(true);
    // Below 0.375: released.
    s.move(100 + rawFor(0.36), 300);
    expect(s.digital.right).toBe(false);
  });
});

describe("VirtualStick — fixed", () => {
  it("hit-tests a grab circle around the base", () => {
    const s = makeStick({ mode: "fixed" }, { ...LAYOUT, zone: undefined });
    expect(s.hitTest(200 + 149, 400)).toBe(true); // within 1.5 × radius
    expect(s.hitTest(200 + 151, 400)).toBe(false);
  });

  it("keeps the base anchored and deflects immediately", () => {
    const s = makeStick({ mode: "fixed" }, { ...LAYOUT, zone: undefined });
    s.engage(1, 260, 400);
    expect(s.basePos).toEqual(LAYOUT.center);
    expect(s.rawValue.x).toBeCloseTo(0.6);
  });
});

describe("VirtualStick — follow", () => {
  it("drags the base along when the finger overshoots", () => {
    const s = makeStick({ mode: "follow" });
    s.engage(1, 200, 300);
    s.move(200, 450); // 150 down, radius 100 → base drags 50
    expect(s.basePos).toEqual({ x: 200, y: 350 });
    expect(s.rawValue.y).toBeCloseTo(1);
  });

  it("keeps the dragged base inside the zone", () => {
    const s = makeStick({ mode: "follow" });
    s.engage(1, 200, 550);
    s.move(200, 750); // would drag base past the 600 bottom
    expect(s.basePos.y).toBe(600);
  });
});

describe("VirtualStick — layout changes", () => {
  it("re-anchors an idle base on setLayout", () => {
    const s = makeStick();
    const moved: StickLayout = { ...LAYOUT, center: { x: 300, y: 500 } };
    s.setLayout(moved);
    expect(s.basePos).toEqual({ x: 300, y: 500 });
  });

  it("clamps an engaged floating base into the new zone", () => {
    const s = makeStick();
    s.engage(1, 350, 300);
    s.setLayout({
      ...LAYOUT,
      zone: { x: 0, y: 0, width: 300, height: 600 },
    });
    expect(s.basePos.x).toBe(300);
    expect(s.active).toBe(true);
  });
});
