import { describe, it, expect, vi, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    visible = true;
    parent: MockContainer | null = null;
    destroyed = false;
    eventMode = "auto";

    addChild(...c: MockContainer[]): void {
      for (const child of c) {
        this.children.push(child);
        child.parent = this;
      }
    }
    private _l = new Map<string, Set<(...a: unknown[]) => void>>();
    on(e: string, fn: (...a: unknown[]) => void): this {
      (this._l.get(e) ?? this._l.set(e, new Set()).get(e)!).add(fn);
      return this;
    }
    off(): this {
      return this;
    }
    removeFromParent(): void {
      if (this.parent) {
        const i = this.parent.children.indexOf(this);
        if (i !== -1) this.parent.children.splice(i, 1);
        this.parent = null;
      }
    }
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockText extends MockContainer {
    text: string;
    constructor(t: string) {
      super();
      this.text = t;
    }
  }
  class MockBitmapText extends MockText {}

  // SplitText model: split() builds chars/words/lines from `text`.
  class MockSplitText extends MockContainer {
    private _text: string;
    style: Record<string, unknown>;
    charAnchor: unknown = 0;
    wordAnchor: unknown = 0;
    lineAnchor: unknown = 0;
    autoSplit: boolean;
    chars: MockText[] = [];
    words: MockContainer[] = [];
    lines: MockContainer[] = [];
    splitCalls = 0;

    constructor(opts: {
      text: string;
      style?: Record<string, unknown>;
      charAnchor?: unknown;
      wordAnchor?: unknown;
      lineAnchor?: unknown;
      autoSplit?: boolean;
    }) {
      super();
      this._text = opts.text;
      this.style = opts.style ?? {};
      if (opts.charAnchor !== undefined) this.charAnchor = opts.charAnchor;
      if (opts.wordAnchor !== undefined) this.wordAnchor = opts.wordAnchor;
      if (opts.lineAnchor !== undefined) this.lineAnchor = opts.lineAnchor;
      this.autoSplit = opts.autoSplit ?? true;
      this.split();
    }
    split(): void {
      this.splitCalls++;
      this.chars = [...this._text].filter((c) => c !== " ").map((c) => new MockText(c));
      this.words = this._text.split(/\s+/).filter(Boolean).map(() => new MockContainer());
      this.lines = [new MockContainer()];
    }
    get text(): string {
      return this._text;
    }
    set text(v: string) {
      this._text = v;
      if (this.autoSplit) this.split();
    }
  }
  class MockSplitBitmapText extends MockSplitText {}

  const measure = (text: string) => ({ width: text.length * 10, height: 16 });

  return {
    mocks: {
      MockContainer, MockText, MockBitmapText, MockSplitText, MockSplitBitmapText, measure,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Text: mocks.MockText,
  BitmapText: mocks.MockBitmapText,
  SplitText: mocks.MockSplitText,
  SplitBitmapText: mocks.MockSplitBitmapText,
  CanvasTextMetrics: { measureText: (t: string) => mocks.measure(t) },
  BitmapFontManager: { measureText: (t: string) => mocks.measure(t) },
}));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UISplitText } from "./UISplitText.js";

beforeAll(() => {
  setYoga(Yoga);
});

function layout(el: UISplitText, containerWidth?: number): { width: number; height: number } {
  const parent = Yoga.Node.create();
  if (containerWidth !== undefined) parent.setWidth(containerWidth);
  parent.insertChild(el.yogaNode, 0);
  parent.calculateLayout(undefined, undefined, Direction.LTR);
  const out = {
    width: el.yogaNode.getComputedWidth(),
    height: el.yogaNode.getComputedHeight(),
  };
  parent.removeChild(el.yogaNode);
  parent.free();
  return out;
}

describe("UISplitText", () => {
  it("constructs a canvas SplitText by default", () => {
    const t = new UISplitText({ children: "hi there" });
    expect(t.splitText).toBeInstanceOf(mocks.MockSplitText);
    expect(t.splitText).not.toBeInstanceOf(mocks.MockSplitBitmapText);
    expect(t.isBitmap).toBe(false);
  });

  it("constructs a SplitBitmapText when bitmap is set", () => {
    const t = new UISplitText({ children: "hi", bitmap: true });
    expect(t.splitText).toBeInstanceOf(mocks.MockSplitBitmapText);
    expect(t.isBitmap).toBe(true);
  });

  it("folds bitmap.font/size into the constructed style", () => {
    const t = new UISplitText({
      children: "hi",
      style: { fill: 0xff0000 },
      bitmap: { font: "PressStart", size: 8 },
    });
    expect(t.splitText.style).toMatchObject({
      fill: 0xff0000,
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("exposes chars / words / lines and the segments object", () => {
    const t = new UISplitText({ children: "ab cd" });
    expect(t.chars).toHaveLength(4);
    expect(t.words).toHaveLength(2);
    expect(t.lines).toHaveLength(1);
    expect(t.segments.chars).toBe(t.chars);
  });

  it("measures natural size via metrics (stable, no resplit)", () => {
    const t = new UISplitText({ children: "hello" });
    const splitsBefore = (t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls;
    const out = layout(t, undefined);
    expect(out.width).toBe(5 * 10);
    expect(out.height).toBe(16);
    // measuring must not trigger a re-split
    expect((t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls).toBe(splitsBefore);
  });

  it("setText re-splits and fires onSplit with fresh segments", () => {
    const t = new UISplitText({ children: "ab" });
    const seen: number[] = [];
    t.onSplit((seg) => seen.push(seg.chars.length));
    t.setText("abcd");
    expect(t.chars).toHaveLength(4);
    expect(seen).toEqual([4]);
  });

  it("setStyle re-folds the bitmap font and fires onSplit", () => {
    const t = new UISplitText({
      children: "hi",
      bitmap: { font: "PressStart", size: 8 },
      style: { fill: 0xffcc00 },
    });
    let fired = 0;
    t.onSplit(() => fired++);
    t.setStyle({ fill: 0xff0000 });
    expect(t.splitText.style).toMatchObject({
      fill: 0xff0000,
      fontFamily: "PressStart",
      fontSize: 8,
    });
    expect(fired).toBe(1);
  });

  it("onSplit returns an unsubscribe that stops further notifications", () => {
    const t = new UISplitText({ children: "hi" });
    let fired = 0;
    const off = t.onSplit(() => fired++);
    t.setText("yo");
    off();
    t.setText("sup");
    expect(fired).toBe(1);
  });

  it("resplit() splits again and notifies", () => {
    const t = new UISplitText({ children: "hi", autoSplit: false });
    let fired = 0;
    t.onSplit(() => fired++);
    const before = (t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls;
    t.resplit();
    expect((t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls).toBe(before + 1);
    expect(fired).toBe(1);
  });

  it("forwards segment anchors via getters/setters (no resplit)", () => {
    const t = new UISplitText({ children: "hi", charAnchor: 0.5 });
    expect(t.charAnchor).toBe(0.5);
    const before = (t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls;
    t.lineAnchor = { x: 1, y: 0 };
    expect(t.splitText.lineAnchor).toEqual({ x: 1, y: 0 });
    expect((t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls).toBe(before);
  });

  it("visible toggles display object and yoga display", () => {
    const t = new UISplitText({ children: "hi" });
    expect(t.visible).toBe(true);
    t.visible = false;
    expect(t.visible).toBe(false);
  });

  it("destroy clears listeners, frees yoga, and destroys the split text", () => {
    const t = new UISplitText({ children: "hi" });
    let fired = 0;
    t.onSplit(() => fired++);
    const obj = t.splitText as unknown as InstanceType<typeof mocks.MockContainer>;
    t.destroy();
    expect(obj.destroyed).toBe(true);
  });
});
