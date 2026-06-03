import { describe, expect, it, vi } from "vitest";

// Mock just the pixi text-metrics surface `measureWrappedText` touches. The
// canvas path can't run under the node test env (no DOM canvas), so we model a
// deterministic wrap: ~8px/char, lines = ceil(chars / charsPerLine).
vi.mock("pixi.js", () => ({
  TextStyle: class {
    constructor(public readonly o: Record<string, unknown>) {}
  },
  CanvasTextMetrics: {
    measureText: (text: string, style: { o: Record<string, unknown> }) => {
      const o = style.o;
      const charW = 8;
      const wrap = o.wordWrap === true;
      const width = wrap
        ? (o.wordWrapWidth as number)
        : Number.MAX_SAFE_INTEGER;
      const perLine = Math.max(1, Math.floor(width / charW));
      const lineCount = wrap ? Math.max(1, Math.ceil(text.length / perLine)) : 1;
      const lineHeight = (o.lineHeight as number) ?? 16;
      return {
        width: Math.min(text.length, perLine) * charW,
        height: lineCount * lineHeight,
        lines: Array.from({ length: lineCount }, () => "x"),
      };
    },
  },
  BitmapFontManager: {
    measureText: (text: string, style: { o: Record<string, unknown> }) => ({
      width: text.length * 8,
      height: (style.o.lineHeight as number) ?? 16,
    }),
  },
}));

import { measureWrappedText } from "./assets.js";

describe("measureWrappedText", () => {
  it("measures a single unwrapped line", () => {
    const m = measureWrappedText("hello world", {
      fontSize: 16,
      lineHeight: 20,
    });
    expect(m.lineCount).toBe(1);
    expect(m.height).toBe(20);
  });

  it("wraps to more lines (and a taller box) as the width shrinks", () => {
    const text = "a".repeat(40);
    const narrow = measureWrappedText(text, {
      fontSize: 16,
      lineHeight: 20,
      wordWrapWidth: 80,
    });
    const wide = measureWrappedText(text, {
      fontSize: 16,
      lineHeight: 20,
      wordWrapWidth: 800,
    });
    expect(narrow.lineCount).toBeGreaterThan(1);
    expect(narrow.height).toBe(narrow.lineCount * 20);
    expect(wide.lineCount).toBeLessThan(narrow.lineCount);
  });

  it("bitmap path returns single-line metrics (no wrap support)", () => {
    const m = measureWrappedText("a".repeat(40), {
      fontSize: 16,
      lineHeight: 20,
      wordWrapWidth: 80,
      bitmap: true,
    });
    expect(m.lineCount).toBe(1);
    expect(m.height).toBe(20);
  });
});
