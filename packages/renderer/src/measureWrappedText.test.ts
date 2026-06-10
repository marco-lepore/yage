import { afterEach, describe, expect, it, vi } from "vitest";

// Mock just the pixi text-metrics surface `measureWrappedText` touches. The
// canvas path can't run under the node test env (no DOM canvas), so we model a
// deterministic wrap: (8 + letterSpacing)px/char, lines = ceil(chars / perLine).
// The bitmap path models pixi's base-measurement units: a 100px base atlas with
// 50-unit glyphs and a 120-unit line height; `measureWrappedText` is expected
// to multiply the returned layout by its `scale` (fontSize / 100).
//
// `measureWrappedText` reuses ONE mutable TextStyle across calls (pixi metrics
// caches key on style identity), so the mock TextStyle is a plain property bag
// seeded from `defaultTextStyle` — leftover-field bugs between calls show up as
// wrong measurements here.
vi.mock("pixi.js", () => {
  class TextStyle {
    static defaultTextStyle: Record<string, unknown> = {
      align: "left",
      breakWords: false,
      dropShadow: null,
      fill: "black",
      fontFamily: "Arial",
      fontSize: 26,
      fontStyle: "normal",
      fontVariant: "normal",
      fontWeight: "normal",
      leading: 0,
      letterSpacing: 0,
      lineHeight: 0,
      padding: 0,
      stroke: null,
      textBaseline: "alphabetic",
      trim: false,
      whiteSpace: "pre",
      wordWrap: false,
      wordWrapWidth: 100,
    };

    static instances = 0;

    [key: string]: unknown;

    constructor(o: Record<string, unknown> = {}) {
      TextStyle.instances += 1;
      Object.assign(this, TextStyle.defaultTextStyle, o);
    }
  }
  type StyleBag = InstanceType<typeof TextStyle>;
  const wrapModel = (
    text: string,
    charW: number,
    wrap: boolean,
    wrapWidth: number,
  ) => {
    const perLine = wrap
      ? Math.max(1, Math.floor(wrapWidth / charW))
      : Number.MAX_SAFE_INTEGER;
    const lineCount = wrap ? Math.max(1, Math.ceil(text.length / perLine)) : 1;
    return { perLine, lineCount };
  };
  return {
    TextStyle,
    CanvasTextMetrics: {
      measureText: (text: string, style: StyleBag) => {
        const charW = 8 + (style.letterSpacing as number);
        const { perLine, lineCount } = wrapModel(
          text,
          charW,
          style.wordWrap === true,
          style.wordWrapWidth as number,
        );
        const lineHeight = (style.lineHeight as number) || 16;
        return {
          width: Math.min(text.length, perLine) * charW,
          height: lineCount * lineHeight,
          lines: Array.from({ length: lineCount }, () => "x"),
        };
      },
    },
    BitmapFontManager: {
      getLayout: (text: string, style: StyleBag) => {
        const base = 100; // baseMeasurementFontSize
        const scale = (style.fontSize as number) / base;
        const charW = 50; // glyph advance in base units
        // pixi converts the px wrap width into base units before wrapping
        const { perLine, lineCount } = wrapModel(
          text,
          charW,
          style.wordWrap === true,
          (style.wordWrapWidth as number) / scale,
        );
        const lineH = (style.lineHeight as number)
          ? (style.lineHeight as number) / scale
          : 120;
        return {
          width: Math.min(text.length, perLine) * charW,
          height: lineCount * lineH,
          scale,
          offsetY: 0,
          lines: Array.from({ length: lineCount }, () => ({ width: 0 })),
        };
      },
    },
  };
});

import { TextStyle as MockTextStyle } from "pixi.js";
import { measureWrappedText } from "./assets.js";
import { setDefaultTextStyle } from "./internal/textConstruction.js";

afterEach(() => setDefaultTextStyle(undefined));

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

  it("bitmap path scales base-unit metrics to fontSize px", () => {
    // fontSize 20 on a base-100 atlas → scale 0.2: 4 glyphs × 50 units × 0.2
    const m = measureWrappedText("abcd", { fontSize: 20, bitmap: true });
    expect(m.width).toBe(40);
    expect(m.height).toBe(24); // 120-unit natural line height × 0.2
    expect(m.lineCount).toBe(1);
  });

  it("bitmap path wraps and reports the wrapped lineCount", () => {
    // 10 glyphs × 10px each; wrap at 40px → 4 per line → 3 lines
    const m = measureWrappedText("a".repeat(10), {
      fontSize: 20,
      lineHeight: 12,
      wordWrapWidth: 40,
      bitmap: true,
    });
    expect(m.lineCount).toBe(3);
    expect(m.height).toBe(3 * 12);
    expect(m.width).toBeLessThanOrEqual(40);
  });

  it("measures through the engine defaultTextStyle merge (render parity)", () => {
    const text = "hello";
    const bare = measureWrappedText(text, { fontSize: 16 });
    setDefaultTextStyle({ letterSpacing: 4 });
    const spaced = measureWrappedText(text, { fontSize: 16 });
    expect(spaced.width).toBe(bare.width + text.length * 4);

    // Per-call options still win over the default, like the render path.
    setDefaultTextStyle({ lineHeight: 99 });
    const m = measureWrappedText(text, { fontSize: 16, lineHeight: 20 });
    expect(m.height).toBe(20);
  });

  it("reuses one style without leaking fields across different calls", () => {
    const text = "a".repeat(40);
    const wrapped = measureWrappedText(text, {
      fontSize: 16,
      lineHeight: 20,
      wordWrapWidth: 80,
    });
    expect(wrapped.lineCount).toBeGreaterThan(1);

    // Same text, no wrap width: the previous call's wordWrap must not stick.
    const unwrapped = measureWrappedText(text, { fontSize: 16 });
    expect(unwrapped.lineCount).toBe(1);
    expect(unwrapped.height).toBe(16); // previous lineHeight 20 reset too

    setDefaultTextStyle({ letterSpacing: 4 });
    measureWrappedText(text, { fontSize: 16 });
    setDefaultTextStyle(undefined);
    // Default gone again → letterSpacing back to 0.
    const plain = measureWrappedText("ab", { fontSize: 16 });
    expect(plain.width).toBe(16);

    // All of the above shared one TextStyle instance.
    expect(
      (MockTextStyle as unknown as { instances: number }).instances,
    ).toBe(1);
  });
});
