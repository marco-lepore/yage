import { describe, it, expect } from "vitest";
import { computePosition, parsePlacement } from "./positioning.js";
import type { Rect, Dimensions } from "./positioning.js";

const VP: Dimensions = { width: 1000, height: 800 };
// Centered trigger so default placements never need flip/shift.
const REF: Rect = { x: 400, y: 380, width: 200, height: 40 };
const FLT: Dimensions = { width: 120, height: 30 };

describe("parsePlacement", () => {
  it("bare side defaults to center", () => {
    expect(parsePlacement("top")).toEqual({ side: "top", align: "center" });
  });
  it("splits side-align", () => {
    expect(parsePlacement("bottom-start")).toEqual({
      side: "bottom",
      align: "start",
    });
    expect(parsePlacement("right-end")).toEqual({
      side: "right",
      align: "end",
    });
  });
});

describe("computePosition — sides (center, offset)", () => {
  it("top: above, centered, lifted by height + offset", () => {
    const r = computePosition(REF, FLT, VP, { placement: "top", offset: 6 });
    expect(r.placement).toBe("top");
    expect(r.x).toBe(400 + 200 / 2 - 120 / 2); // 440
    expect(r.y).toBe(380 - 30 - 6); // 344
  });
  it("bottom: below, centered", () => {
    const r = computePosition(REF, FLT, VP, { placement: "bottom", offset: 6 });
    expect(r.x).toBe(440);
    expect(r.y).toBe(380 + 40 + 6); // 426
  });
  it("right: past right edge, vertically centered", () => {
    const r = computePosition(REF, FLT, VP, { placement: "right", offset: 8 });
    expect(r.x).toBe(400 + 200 + 8); // 608
    expect(r.y).toBe(380 + 40 / 2 - 30 / 2); // 385
  });
  it("left: shifted left by width + offset", () => {
    const r = computePosition(REF, FLT, VP, { placement: "left", offset: 8 });
    expect(r.x).toBe(400 - 120 - 8); // 272
    expect(r.y).toBe(385);
  });
});

describe("computePosition — alignment", () => {
  it("top-start aligns left edges", () => {
    const r = computePosition(REF, FLT, VP, { placement: "top-start" });
    expect(r.x).toBe(400);
    expect(r.placement).toBe("top-start");
  });
  it("top-end aligns right edges", () => {
    const r = computePosition(REF, FLT, VP, { placement: "top-end" });
    expect(r.x).toBe(400 + 200 - 120); // 480
  });
  it("left-start aligns top edges", () => {
    const r = computePosition(REF, FLT, VP, { placement: "left-start" });
    expect(r.y).toBe(380);
  });
  it("left-end aligns bottom edges", () => {
    const r = computePosition(REF, FLT, VP, { placement: "left-end" });
    expect(r.y).toBe(380 + 40 - 30); // 390
  });
});

describe("flip — main axis", () => {
  it("flips top→bottom when the trigger hugs the top edge", () => {
    const ref: Rect = { x: 400, y: 8, width: 200, height: 40 };
    const r = computePosition(ref, FLT, VP, { placement: "top", offset: 6 });
    expect(r.placement).toBe("bottom");
    expect(r.y).toBe(8 + 40 + 6); // 54
  });
  it("flips right→left when the trigger hugs the right edge", () => {
    const ref: Rect = { x: 950, y: 380, width: 40, height: 40 };
    const r = computePosition(ref, FLT, VP, { placement: "right", offset: 6 });
    expect(r.placement).toBe("left");
    expect(r.x).toBe(950 - 120 - 6); // 824
  });
  it("does not flip when the opposite side overflows more", () => {
    // top overflows by 110; bottom would overflow by 130 → keep top.
    const tall: Dimensions = { width: 120, height: 500 };
    const ref: Rect = { x: 400, y: 390, width: 200, height: 40 };
    const r = computePosition(ref, tall, VP, { placement: "top", offset: 0 });
    expect(r.placement).toBe("top");
  });
  it("flip can be disabled", () => {
    const ref: Rect = { x: 400, y: 8, width: 200, height: 40 };
    const r = computePosition(ref, FLT, VP, {
      placement: "top",
      flip: false,
    });
    expect(r.placement).toBe("top");
    expect(r.y).toBeLessThan(0);
  });
});

describe("shift — cross axis", () => {
  it("clamps a top tooltip back inside when the trigger is near the left edge", () => {
    const ref: Rect = { x: 0, y: 380, width: 40, height: 40 };
    const r = computePosition(ref, FLT, VP, {
      placement: "top",
      padding: 8,
    });
    // Centered would be x = 0 + 20 - 60 = -40 → clamped to padding.
    expect(r.x).toBe(8);
  });
  it("clamps against the right edge", () => {
    const ref: Rect = { x: 990, y: 380, width: 10, height: 40 };
    const r = computePosition(ref, FLT, VP, {
      placement: "top",
      padding: 8,
    });
    expect(r.x).toBe(VP.width - 8 - FLT.width); // 872
  });
  it("floating wider than the viewport pins to the start padding", () => {
    const wide: Dimensions = { width: 1200, height: 30 };
    const r = computePosition(REF, wide, VP, {
      placement: "top",
      padding: 8,
    });
    expect(r.x).toBe(8);
  });
  it("shift can be disabled", () => {
    const ref: Rect = { x: 0, y: 380, width: 40, height: 40 };
    const r = computePosition(ref, FLT, VP, {
      placement: "top",
      shift: false,
    });
    expect(r.x).toBe(0 + 20 - 60); // -40, not clamped
  });
});

describe("available size", () => {
  it("reports space above for a top placement", () => {
    const r = computePosition(REF, FLT, VP, {
      placement: "top",
      padding: 10,
    });
    expect(r.available.height).toBe(380 - 10);
    expect(r.available.width).toBe(1000 - 20);
  });
  it("reports space to the right for a right placement", () => {
    const r = computePosition(REF, FLT, VP, {
      placement: "right",
      padding: 10,
    });
    expect(r.available.width).toBe(1000 - (400 + 200) - 10); // 390
    expect(r.available.height).toBe(800 - 20);
  });
  it("reflects the flipped side", () => {
    const ref: Rect = { x: 400, y: 8, width: 200, height: 40 };
    const r = computePosition(ref, FLT, VP, { placement: "top" });
    expect(r.placement).toBe("bottom");
    expect(r.available.height).toBe(800 - (8 + 40)); // space below
  });
});
