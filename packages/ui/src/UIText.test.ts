import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    visible = true;
    parent: MockContainer | null = null;
    destroyed = false;
    eventMode = "auto";

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const fn of this._listeners.get(event) ?? []) fn(...args);
    }

    removeFromParent(): void {
      if (this.parent) {
        const idx = this.parent.children.indexOf(this);
        if (idx !== -1) this.parent.children.splice(idx, 1);
        this.parent = null;
      }
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  /**
   * Text measurement model: each character is `charWidth` wide. `wordWrap`
   * does a simple greedy word break on spaces — enough to exercise the wrap
   * path without depending on Pixi's real layout engine.
   */
  class MockText extends MockContainer {
    private _text = "";
    style: {
      wordWrap?: boolean;
      wordWrapWidth?: number;
      [k: string]: unknown;
    };
    static charWidth = 10;
    static lineHeight = 16;

    resolution: number | undefined;

    constructor(opts?: {
      text?: string;
      style?: Record<string, unknown>;
      resolution?: number;
    }) {
      super();
      this.style = opts?.style ?? {};
      this._text = opts?.text ?? "";
      this.resolution = opts?.resolution;
    }

    get text(): string {
      return this._text;
    }

    set text(v: string) {
      this._text = v;
    }

    get width(): number {
      if (this.style.wordWrap && this.style.wordWrapWidth) {
        const lines = this.wrappedLines(this.style.wordWrapWidth);
        return Math.max(0, ...lines.map((l) => l.length * MockText.charWidth));
      }
      return this._text.length * MockText.charWidth;
    }

    get height(): number {
      if (this.style.wordWrap && this.style.wordWrapWidth) {
        const lines = this.wrappedLines(this.style.wordWrapWidth);
        return Math.max(1, lines.length) * MockText.lineHeight;
      }
      return MockText.lineHeight;
    }

    private wrappedLines(maxWidth: number): string[] {
      const charsPerLine = Math.max(1, Math.floor(maxWidth / MockText.charWidth));
      const words = this._text.split(" ");
      const out: string[] = [];
      let current = "";
      for (const w of words) {
        const candidate = current ? `${current} ${w}` : w;
        if (candidate.length <= charsPerLine) {
          current = candidate;
        } else {
          if (current) out.push(current);
          current = w;
        }
      }
      if (current) out.push(current);
      return out.length === 0 ? [""] : out;
    }
  }

  // Distinct subclass so tests can assert which Pixi class was constructed;
  // inherits MockText's measurement model so the wrap / truncate paths
  // exercise identically under a bitmap font.
  class MockBitmapText extends MockText {}

  return { mocks: { MockContainer, MockText, MockBitmapText } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Text: mocks.MockText,
  BitmapText: mocks.MockBitmapText,
}));

import Yoga, { Direction } from "yoga-layout";
import { setDefaultTextStyle } from "@yagejs/renderer";
import { setYoga } from "./yoga-helpers.js";
import { setUIDefaultTextStyle } from "./text-defaults.js";
import { UIText } from "./UIText.js";

beforeAll(() => {
  setYoga(Yoga);
});

afterEach(() => {
  setDefaultTextStyle(undefined);
  setUIDefaultTextStyle(undefined);
  vi.restoreAllMocks();
});

/**
 * Compute layout for a UIText constrained inside a parent with `containerWidth`.
 * Returns the text node's computed width/height.
 */
function layoutInContainer(
  text: UIText,
  containerWidth: number | undefined,
): { width: number; height: number } {
  const parent = Yoga.Node.create();
  if (containerWidth !== undefined) parent.setWidth(containerWidth);
  parent.insertChild(text.yogaNode, 0);
  parent.calculateLayout(undefined, undefined, Direction.LTR);
  const out = {
    width: text.yogaNode.getComputedWidth(),
    height: text.yogaNode.getComputedHeight(),
  };
  parent.removeChild(text.yogaNode);
  parent.free();
  return out;
}

function renderedText(t: UIText): string {
  // The UIText keeps a private `text: Text` field — read it via the
  // measurement-visible side effect on the mock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((t as any).text as { text: string }).text;
}

describe("UIText.measure", () => {
  it("short string fits intrinsic width", () => {
    const t = new UIText({ children: "hi" });
    const out = layoutInContainer(t, undefined);
    expect(out.width).toBe(2 * 10); // "hi" * charWidth
    expect(out.height).toBe(16);
  });

  it("long string wraps to container width when bounded", () => {
    const t = new UIText({ children: "the quick brown fox jumps" });
    const out = layoutInContainer(t, 100);
    expect(out.height).toBeGreaterThan(16); // wrapped to multiple lines
    expect(out.width).toBeLessThanOrEqual(100);
  });

  it('truncate: "ellipsis" produces a single ellipsis-terminated line', () => {
    const t = new UIText({
      children: "this string is far too long for the slot",
      truncate: "ellipsis",
    });
    const out = layoutInContainer(t, 80);
    expect(out.height).toBe(16); // single line
    const rendered = renderedText(t);
    expect(rendered.endsWith("…")).toBe(true);
    expect(out.width).toBeLessThanOrEqual(80);
  });

  it('truncate: "clip" cuts the text at the slot edge without an ellipsis suffix', () => {
    const t = new UIText({
      children: "loooong unbroken string",
      truncate: "clip",
    });
    // Intrinsic is 23 * 10 = 230px; the rendered text substrings to fit
    // the slot so neither the slot nor the rendered pixels overflow.
    const out = layoutInContainer(t, 50);
    expect(out.height).toBe(16);
    expect(out.width).toBeLessThanOrEqual(50);
    const rendered = renderedText(t);
    expect(rendered.endsWith("…")).toBe(false);
    expect("loooong unbroken string".startsWith(rendered)).toBe(true);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('truncate: "clip" leaves a fitting string untouched', () => {
    const t = new UIText({
      children: "short",
      truncate: "clip",
    });
    layoutInContainer(t, 200);
    expect(renderedText(t)).toBe("short");
  });

  it("update({ truncate: undefined }) restores wrap behavior", () => {
    const t = new UIText({
      children: "the quick brown fox jumps",
      truncate: "ellipsis",
    });
    layoutInContainer(t, 80);
    expect(renderedText(t).endsWith("…")).toBe(true);

    t.update({ truncate: undefined });
    const out = layoutInContainer(t, 100);
    expect(out.height).toBeGreaterThan(16); // wrapped again
    expect(renderedText(t)).toBe("the quick brown fox jumps");
  });
});

/** Read the private underlying pixi text object the UIText constructed. */
function textObject(t: UIText): {
  style: Record<string, unknown>;
  resolution: number | undefined;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (t as any).text;
}

describe("UIText bitmap + resolution", () => {
  it("constructs a canvas Text by default", () => {
    const t = new UIText({ children: "hi" });
    expect(textObject(t)).toBeInstanceOf(mocks.MockText);
    expect(textObject(t)).not.toBeInstanceOf(mocks.MockBitmapText);
  });

  it("constructs a BitmapText when bitmap: true", () => {
    const t = new UIText({ children: "hi", bitmap: true });
    expect(textObject(t)).toBeInstanceOf(mocks.MockBitmapText);
  });

  it("bitmap: { font, size } folds into the constructed style", () => {
    const t = new UIText({
      children: "hi",
      style: { fill: 0x00ff00 },
      bitmap: { font: "PressStart", size: 8 },
    });
    expect(textObject(t)).toBeInstanceOf(mocks.MockBitmapText);
    expect(textObject(t).style).toMatchObject({
      fill: 0x00ff00,
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("setStyle re-folds the bitmap font so a recolour keeps fontFamily", () => {
    const t = new UIText({
      children: "score",
      style: { fill: 0xffcc00 },
      bitmap: { font: "PressStart", size: 8 },
    });
    // Recolour with a raw style that carries no fontFamily.
    t.setStyle({ fill: 0xff0000 });
    expect(textObject(t).style).toMatchObject({
      fill: 0xff0000,
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("update({ style }) re-folds the bitmap font", () => {
    const t = new UIText({
      children: "score",
      bitmap: { font: "PressStart", size: 8 },
    });
    t.update({ style: { fill: 0x0000ff } });
    expect(textObject(t).style).toMatchObject({
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("honors PR #67 wrap semantics under a bitmap font", () => {
    const t = new UIText({
      children: "the quick brown fox jumps",
      bitmap: true,
    });
    const out = layoutInContainer(t, 100);
    expect(out.height).toBeGreaterThan(16); // wrapped to multiple lines
    expect(out.width).toBeLessThanOrEqual(100);
  });

  it("honors truncate: ellipsis under a bitmap font", () => {
    const t = new UIText({
      children: "this string is far too long for the slot",
      bitmap: true,
      truncate: "ellipsis",
    });
    const out = layoutInContainer(t, 80);
    expect(out.height).toBe(16); // single line
    expect(renderedText(t).endsWith("…")).toBe(true);
    expect(out.width).toBeLessThanOrEqual(80);
  });

  it("forwards resolution to a canvas Text", () => {
    const t = new UIText({ children: "hi", resolution: 4 });
    expect(textObject(t).resolution).toBe(4);
  });

  it("does NOT forward resolution to a BitmapText", () => {
    const t = new UIText({ children: "hi", bitmap: true, resolution: 4 });
    expect(textObject(t)).toBeInstanceOf(mocks.MockBitmapText);
    expect(textObject(t).resolution).toBeUndefined();
  });

  it("warns (and keeps the constructed class) when update() changes bitmap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = new UIText({ children: "hi" });
    expect(textObject(t)).not.toBeInstanceOf(mocks.MockBitmapText);

    t.update({ bitmap: true });

    // Construction-only: the underlying Pixi class does not change…
    expect(textObject(t)).toBeInstanceOf(mocks.MockText);
    expect(textObject(t)).not.toBeInstanceOf(mocks.MockBitmapText);
    // …but the dropped change is surfaced rather than silently ignored.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("construction-only"),
    );
    warn.mockRestore();
  });

  it("warns when update() changes resolution", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = new UIText({ children: "hi", resolution: 1 });
    t.update({ resolution: 2 });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("construction-only"),
    );
    warn.mockRestore();
  });

  it("does not warn when update() repeats the same bitmap value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = new UIText({ children: "hi", bitmap: { font: "A", size: 8 } });
    t.update({ bitmap: { font: "A", size: 8 }, children: "ho" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when update() passes bitmap: false to a non-bitmap text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No `bitmap` at construction (_bitmap === undefined); the reconciler
    // mounts <Text bitmap={false}>. Both mean canvas text — no warn.
    const t = new UIText({ children: "hi" });
    t.update({ bitmap: false });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("decouples the cached bitmap option from the caller's object", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bitmap: { font: string; size?: number } = { font: "A" };
    // Caller mutates their object after construction. The cached snapshot
    // must be a copy, so a later update() with the (now-stale) reference is
    // correctly detected as a change from the constructed font.
    const t = new UIText({ children: "hi", bitmap });
    bitmap.font = "B";
    t.update({ bitmap });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("construction-only"),
    );
    warn.mockRestore();
  });
});

describe("UIText default text style", () => {
  it("layers the UI default over the renderer default; per-text wins", () => {
    setDefaultTextStyle({ fontFamily: "Renderer", fill: 0x111111, fontSize: 10 });
    setUIDefaultTextStyle({ fontFamily: "UI", fontSize: 14 });
    const t = new UIText({ children: "hi", style: { fill: 0xff0000 } });
    expect(textObject(t).style).toMatchObject({
      fontFamily: "UI", // UI default beats renderer default
      fill: 0xff0000, // per-text beats both
      fontSize: 14,
    });
  });

  it("keeps the UI default under a recolour via setStyle", () => {
    setUIDefaultTextStyle({ fontFamily: "UI" });
    const t = new UIText({ children: "hi", style: { fill: 0xff0000 } });
    t.setStyle({ fill: 0x00ff00 });
    expect(textObject(t).style).toMatchObject({
      fontFamily: "UI",
      fill: 0x00ff00,
    });
  });
});

describe("UIText bitmap-in-style warning", () => {
  it("warns when `bitmap` is nested inside `style`", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new UIText({
      children: "hi",
      // Mistake: bitmap folded into style instead of a sibling prop.
      style: { fill: 0xffffff, bitmap: { font: "A" } } as never,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("`bitmap` was found inside `style`"),
    );
  });

  it("warns when `bitmap` is nested in style on the setStyle path", () => {
    const t = new UIText({ children: "hi" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t.setStyle({ fill: 0xff0000, bitmap: { font: "A" } } as never);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("`bitmap` was found inside `style`"),
    );
  });

  it("does not warn for a correct sibling bitmap prop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new UIText({ children: "hi", bitmap: { font: "A" }, style: { fill: 0xffffff } });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("`bitmap` was found inside `style`"),
    );
  });
});
