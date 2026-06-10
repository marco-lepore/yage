import { beforeEach, describe, expect, it, vi } from "vitest";

// Deterministic metrics standing in for the renderer's `measureWrappedText`
// (wrap-aware on BOTH the canvas and bitmap paths): 8px/char, lines =
// ceil(chars / floor(wrapWidth / 8)). Calls are recorded so the bitmap path's
// option forwarding (`fontFamily` = atlas name, `bitmap: true`) is assertable.
const calls: Array<{ text: string; options: Record<string, unknown> }> = [];
vi.mock("@yagejs/renderer", () => ({
  measureWrappedText: (text: string, options: Record<string, unknown>) => {
    calls.push({ text, options });
    const charW = 8;
    const wrap = typeof options.wordWrapWidth === "number";
    const perLine = wrap
      ? Math.max(1, Math.floor((options.wordWrapWidth as number) / charW))
      : Number.MAX_SAFE_INTEGER;
    const lineCount = wrap ? Math.max(1, Math.ceil(text.length / perLine)) : 1;
    const lineHeight = options.lineHeight as number;
    return {
      width: Math.min(text.length, perLine) * charW,
      height: lineCount * lineHeight,
      lineCount,
    };
  },
}));

import { bubbleSize } from "./bubbleSizing.js";

const CFG = {
  minWidth: 60,
  maxWidth: 200,
  padding: 10,
  minHeight: 40,
  textSize: 16,
  lineHeight: 20,
} as const;

beforeEach(() => {
  calls.length = 0;
});

describe("bubbleSize", () => {
  it("widens to a short line (snug bubble) above minWidth", () => {
    const size = bubbleSize("hello world", CFG); // 11 chars → 88px + padding
    expect(size).toEqual({ width: 108, height: 40 });
  });

  it("caps at maxWidth and grows height to the wrapped line count", () => {
    const text = "a".repeat(40); // 320px natural > 180px inner → wraps
    const size = bubbleSize(text, CFG);
    expect(size.width).toBe(CFG.maxWidth);
    // inner 180px → 22 chars/line → 2 lines → 2*20 + 2*10 padding
    expect(size.height).toBe(60);
  });

  it("sizes the bitmap path identically (no fixed-size special case)", () => {
    const text = "a".repeat(40);
    const canvas = bubbleSize(text, { ...CFG, fontFamily: "serif" });
    const bitmap = bubbleSize(text, { ...CFG, bitmapFont: "PixelFont" });
    expect(bitmap).toEqual(canvas);
    expect(bitmap.height).toBeGreaterThan(CFG.minHeight); // wrapped, not clipped
  });

  it("measures bitmap text through the atlas family with bitmap: true", () => {
    bubbleSize("a".repeat(40), { ...CFG, bitmapFont: "PixelFont" });
    expect(calls.length).toBe(2); // natural pass + wrap pass
    for (const call of calls) {
      expect(call.options.fontFamily).toBe("PixelFont");
      expect(call.options.bitmap).toBe(true);
    }
  });

  it("a short bitmap line gets a snug bubble, not a maxWidth one", () => {
    const size = bubbleSize("hi", { ...CFG, bitmapFont: "PixelFont" });
    expect(size).toEqual({ width: CFG.minWidth, height: 40 });
  });
});
