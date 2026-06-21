import { describe, expect, it } from "vitest";

import { stackChoiceRows } from "./ChoiceListPresenter.js";

/**
 * The choice list grows to fit. `stackChoiceRows` is the single geometry source
 * row placement, the highlight bar, and pointer hit-testing all consume, so they
 * can't drift. (Real text measurement + rendering is exercised by the
 * dialogue-addon e2e.)
 */
const BOX = { x: 32, y: 360, width: 736, height: 160 };
const PADDING = 16;
const BOTTOM = BOX.y + BOX.height - PADDING; // 504

describe("stackChoiceRows", () => {
  it("anchors the last row at the box bottom and grows upward", () => {
    const rects = stackChoiceRows([22, 22, 22], BOX, PADDING);
    const last = rects[rects.length - 1]!;
    expect(last.y + last.height).toBe(BOTTOM);
    // Rows are ordered top→bottom by index and grow upward from the anchor.
    expect(rects[0]!.y).toBeLessThan(rects[1]!.y);
    expect(rects[1]!.y).toBeLessThan(rects[2]!.y);
  });

  it("stacks rows contiguously (gap is baked into each slot height)", () => {
    const rects = stackChoiceRows([22, 22, 22], BOX, PADDING);
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i]!.y + rects[i]!.height).toBe(rects[i + 1]!.y);
    }
  });

  it("shares one x + width across every row", () => {
    const rects = stackChoiceRows([22, 30, 22], BOX, PADDING);
    for (const r of rects) {
      expect(r.x).toBe(BOX.x + PADDING);
      expect(r.width).toBe(BOX.width - 2 * PADDING);
    }
  });

  it("honours per-row (wrapped, multi-line) heights", () => {
    const rects = stackChoiceRows([44, 22, 22], BOX, PADDING);
    expect(rects[0]!.height).toBe(44); // a two-line row is taller
    expect(rects[0]!.y + 44).toBe(rects[1]!.y); // still contiguous
  });

  it("renders a 9-option hub usably: 9 distinct on-screen rows", () => {
    const rects = stackChoiceRows(new Array(9).fill(22), BOX, PADDING);
    expect(rects).toHaveLength(9);
    expect(rects.every((r) => r.y >= 0)).toBe(true); // all on screen
    expect(rects[8]!.y + rects[8]!.height).toBe(BOTTOM); // bottom-anchored
    // No two rows overlap.
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i]!.y + rects[i]!.height).toBeLessThanOrEqual(rects[i + 1]!.y);
    }
  });

  it("caps at the screen top: a list taller than the screen clamps to y ≥ 0", () => {
    const tightBox = { x: 0, y: 0, width: 400, height: 100 };
    const rects = stackChoiceRows(new Array(10).fill(22), tightBox, 10);
    expect(rects.every((r) => r.y >= 0)).toBe(true);
    expect(rects[0]!.y).toBe(0); // the topmost row clamps to the screen top
  });
});
