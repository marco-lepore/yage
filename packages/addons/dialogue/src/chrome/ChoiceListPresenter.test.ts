import { describe, expect, it } from "vitest";

import { stackChoiceRows } from "../render/BoxLayout.js";

/**
 * The choice list grows to fit. `stackChoiceRows` is the single geometry source
 * row placement, the highlight bar, and pointer hit-testing all consume, so they
 * can't drift. (Real text measurement + rendering is exercised by the
 * dialogue-addon e2e.)
 */
const BOX = { x: 32, y: 360, width: 736, height: 160 };
const PADDING = 16;
const TOP = BOX.y + PADDING;

describe("stackChoiceRows", () => {
  it("anchors the first row at the content top", () => {
    const rects = stackChoiceRows([22, 22, 22], BOX, PADDING);
    const last = rects[rects.length - 1]!;
    expect(last.y + last.height).toBe(TOP + 66);
    // Rows follow content order.
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
    expect(rects[0]!.y).toBe(TOP);
    // No two rows overlap.
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i]!.y + rects[i]!.height).toBeLessThanOrEqual(
        rects[i + 1]!.y,
      );
    }
  });

  it("a list taller than the screen stays top-aligned and non-overlapping", () => {
    const tightBox = { x: 0, y: 0, width: 400, height: 100 };
    const rects = stackChoiceRows(new Array(10).fill(22), tightBox, 10);
    // The first row starts at the padded top.
    expect(rects[0]!.y).toBe(10);
    // Rows stay contiguous (never pile up) even when they overflow.
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i]!.y + rects[i]!.height).toBe(rects[i + 1]!.y);
    }
    // Oversized lists continue below the frame.
    expect(rects[9]!.y + rects[9]!.height).toBeGreaterThan(tightBox.height);
  });
});
