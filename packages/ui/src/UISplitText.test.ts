import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

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
    emit(e: string, ...a: unknown[]): void {
      for (const fn of this._l.get(e) ?? []) fn(...a);
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
    destroyOpts: unknown;
    destroy(opts?: unknown): void {
      this.destroyed = true;
      this.destroyOpts = opts;
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
    // Named as Pixi names it: the option has no setter, so the guard writes
    // the field.
    _autoSplit: boolean;
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
      this._autoSplit = opts.autoSplit ?? true;
      if (this._autoSplit) this.split();
    }
    split(): void {
      this.splitCalls++;
      this.chars = [...this._text]
        .filter((c) => c !== " ")
        .map((c) => new MockText(c));
      this.words = this._text
        .split(/\s+/)
        .filter(Boolean)
        .map(() => new MockContainer());
      this.lines = this._text === "" ? [] : [new MockContainer()];
      // Pixi ends a split with `addChild(...this.lines)`. An empty string
      // produces no lines, so that is a zero-argument call, which reads
      // `children[0].parent` and throws. Reproduced here so the guard that
      // keeps an empty string out of the split has something to fail against.
      if (this.lines.length === 0) {
        throw new TypeError(
          "Cannot read properties of undefined (reading 'parent')",
        );
      }
      for (const line of this.lines) this.addChild(line);
    }
    get text(): string {
      return this._text;
    }
    set text(v: string) {
      this._text = v;
      this.lines = [];
      this.words = [];
      this.chars = [];
      if (this._autoSplit) this.split();
    }
  }
  class MockSplitBitmapText extends MockSplitText {}

  const measure = (text: string) => ({ width: text.length * 10, height: 16 });

  /** Records the outline a focused element draws, so a test can read it. */
  class MockGraphics extends MockContainer {
    measurable = true;
    lastRect:
      | { x: number; y: number; width: number; height: number; radius?: number }
      | undefined;
    lastStroke: { color?: number; width?: number } | undefined;
    clear(): MockGraphics {
      return this;
    }
    roundRect(
      x: number,
      y: number,
      width: number,
      height: number,
      radius?: number,
    ): MockGraphics {
      this.lastRect = {
        x,
        y,
        width,
        height,
        ...(radius === undefined ? {} : { radius }),
      };
      return this;
    }
    stroke(style?: { color?: number; width?: number }): MockGraphics {
      this.lastStroke = style;
      return this;
    }
  }

  return {
    mocks: {
      MockContainer,
      MockGraphics,
      MockText,
      MockBitmapText,
      MockSplitText,
      MockSplitBitmapText,
      measure,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
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
import { getFocusState } from "./focus/FocusState.js";
import { setUIFocusStyle } from "./internal/focus-outline.js";
import { takePointerRequest } from "./focus/pointer-request.js";

beforeAll(() => {
  setYoga(Yoga);
});

function layout(
  el: UISplitText,
  containerWidth?: number,
): { width: number; height: number } {
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

  it("bitmap text reads fontFamily / fontSize from style", () => {
    const t = new UISplitText({
      children: "hi",
      bitmap: true,
      style: { fill: 0xff0000, fontFamily: "PressStart", fontSize: 8 },
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
    const splitsBefore = (
      t.splitText as InstanceType<typeof mocks.MockSplitText>
    ).splitCalls;
    const out = layout(t, undefined);
    expect(out.width).toBe(5 * 10);
    expect(out.height).toBe(16);
    // measuring must not trigger a re-split
    expect(
      (t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls,
    ).toBe(splitsBefore);
  });

  it("setText re-splits and fires onSplit with fresh segments", () => {
    const t = new UISplitText({ children: "ab" });
    const seen: number[] = [];
    t.onSplit((seg) => seen.push(seg.chars.length));
    t.setText("abcd");
    expect(t.chars).toHaveLength(4);
    expect(seen).toEqual([4]);
  });

  it("setStyle replaces the style and fires onSplit", () => {
    const t = new UISplitText({
      children: "hi",
      bitmap: true,
      style: { fontFamily: "PressStart", fontSize: 8, fill: 0xffcc00 },
    });
    let fired = 0;
    t.onSplit(() => fired++);
    t.setStyle({ fontFamily: "PressStart", fontSize: 8, fill: 0xff0000 });
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

  describe("empty text", () => {
    it("renders no segments instead of throwing", () => {
      const t = new UISplitText({ children: "" });
      expect(t.chars).toEqual([]);
      expect(t.words).toEqual([]);
      expect(t.lines).toEqual([]);
    });

    it("measures zero", () => {
      const t = new UISplitText({ children: "" });
      t.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      expect(t.yogaNode.getComputedWidth()).toBe(0);
      expect(t.yogaNode.getComputedHeight()).toBe(0);
    });

    it("survives being cleared and splits again on the next value", () => {
      const t = new UISplitText({ children: "hi" });
      expect(() => t.setText("")).not.toThrow();
      expect(t.chars).toEqual([]);

      t.setText("sup");
      expect(t.chars).toHaveLength(3);
    });

    it("emits empty segments to listeners", () => {
      const t = new UISplitText({ children: "hi" });
      let seen: { chars: unknown[] } | undefined;
      t.onSplit((segments) => {
        seen = segments;
      });
      t.setText("");
      expect(seen?.chars).toEqual([]);
    });

    it("leaves an empty text empty on resplit", () => {
      const t = new UISplitText({ children: "", autoSplit: false });
      expect(() => t.resplit()).not.toThrow();
      expect(t.lines).toEqual([]);
    });

    it("survives a style change while empty", () => {
      const t = new UISplitText({ children: "" });
      expect(() => t.setStyle({ fontSize: 24 })).not.toThrow();
      expect(t.chars).toEqual([]);
    });
  });

  it("resplit() splits again and notifies", () => {
    const t = new UISplitText({ children: "hi", autoSplit: false });
    let fired = 0;
    t.onSplit(() => fired++);
    const before = (t.splitText as InstanceType<typeof mocks.MockSplitText>)
      .splitCalls;
    t.resplit();
    expect(
      (t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls,
    ).toBe(before + 1);
    expect(fired).toBe(1);
  });

  it("forwards segment anchors via getters/setters (no resplit)", () => {
    const t = new UISplitText({ children: "hi", charAnchor: 0.5 });
    expect(t.charAnchor).toBe(0.5);
    const before = (t.splitText as InstanceType<typeof mocks.MockSplitText>)
      .splitCalls;
    t.lineAnchor = { x: 1, y: 0 };
    expect(t.splitText.lineAnchor).toEqual({ x: 1, y: 0 });
    expect(
      (t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls,
    ).toBe(before);
  });

  it("setText with autoSplit:false defers onSplit (no empty-segment emit)", () => {
    const t = new UISplitText({ children: "hi", autoSplit: false });
    let fired = 0;
    t.onSplit(() => fired++);
    t.setText("new content");
    expect(fired).toBe(0); // deferred — would otherwise fire with empty chars
    t.resplit();
    expect(fired).toBe(1); // the real split notifies
  });

  it("update() skips re-style (no re-split/emit) when style content is unchanged", () => {
    const t = new UISplitText({ children: "hi", style: { fill: 0xffffff } });
    let fired = 0;
    t.onSplit(() => fired++);
    const before = (t.splitText as InstanceType<typeof mocks.MockSplitText>)
      .splitCalls;
    // Fresh object literal, same content — the React re-render case.
    t.update({ style: { fill: 0xffffff } });
    expect(fired).toBe(0);
    expect(
      (t.splitText as InstanceType<typeof mocks.MockSplitText>).splitCalls,
    ).toBe(before);
    // A genuine change does re-style and notify.
    t.update({ style: { fill: 0xff0000 } });
    expect(fired).toBe(1);
  });

  it("emitSplit tolerates a listener unsubscribing itself mid-notify", () => {
    const t = new UISplitText({ children: "hi" });
    const order: string[] = [];
    const offA = t.onSplit(() => {
      order.push("a");
      offA();
    });
    t.onSplit(() => order.push("b"));
    t.setText("x");
    expect(order).toEqual(["a", "b"]); // b not skipped despite a's self-removal
  });

  it("destroy passes { children: true } to free the segment display objects", () => {
    const t = new UISplitText({ children: "hi" });
    const obj = t.splitText as unknown as { destroyOpts?: unknown };
    t.destroy();
    expect(obj.destroyOpts).toEqual({ children: true });
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
    const obj = t.splitText as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    t.destroy();
    expect(obj.destroyed).toBe(true);
  });
});

describe("UISplitText focus", () => {
  // An outline is drawn only where one is asked for, so these boxes are
  // measured against the outline a game asks for once for the whole UI.
  beforeEach(() => setUIFocusStyle({}));
  afterEach(() => setUIFocusStyle(undefined));

  /** Fire a Pixi event on the element's own display object. */
  const emitOn = (t: UISplitText, event: string): void =>
    (t.displayObject as unknown as { emit(e: string): void }).emit(event);

  it("stays out of focus navigation by default", () => {
    const t = new UISplitText({ children: "hi there" });

    expect(getFocusState(t)?.focusable).toBe(false);
    t.destroy();
  });

  /** The outline a focused element draws, or `undefined` before it takes one. */
  function outlineOf(element: {
    displayObject: unknown;
  }): InstanceType<typeof mocks.MockGraphics> | undefined {
    const children = (
      element.displayObject as unknown as InstanceType<
        typeof mocks.MockContainer
      >
    ).children;
    return children.find(
      (child): child is InstanceType<typeof mocks.MockGraphics> =>
        child instanceof mocks.MockGraphics && child.measurable === false,
    );
  }

  it("joins focus navigation and reports focus changes", () => {
    const onFocusChange = vi.fn();
    const t = new UISplitText({
      children: "hi there",
      focusable: true,
      onFocusChange,
    });

    const state = getFocusState(t);
    expect(state?.focusable).toBe(true);
    state?._setFocused(true);

    expect(onFocusChange).toHaveBeenCalledWith(true);
    t.destroy();
  });

  it("outlines a focusable block at the box layout gave it", () => {
    const t = new UISplitText({
      children: "hi there",
      focusable: true,
      width: 120,
      height: 40,
    });
    getFocusState(t)?._setFocused(true);

    t.yogaNode.calculateLayout(120, 40, Direction.LTR);
    t.applyLayout();

    expect(outlineOf(t)?.lastRect).toMatchObject({
      x: 1,
      y: 1,
      width: 118,
      height: 38,
    });
    t.destroy();
  });

  it("takes the focus props an update carries", () => {
    const t = new UISplitText({ children: "hi there" });

    t.update({ focusable: true, focusId: "title" });

    expect(getFocusState(t)?.focusable).toBe(true);
    expect(getFocusState(t)?.id).toBe("title");
    t.destroy();
  });

  it("asks for hover focus while the pointer is over it", () => {
    const t = new UISplitText({ children: "hi there", focusable: true });
    takePointerRequest();

    emitOn(t, "pointerover");

    expect(takePointerRequest()?.trigger).toBe("hover");
    t.destroy();
  });

  it("asks for press focus when the pointer presses it", () => {
    const t = new UISplitText({ children: "hi there", focusable: true });
    takePointerRequest();

    emitOn(t, "pointerdown");

    const request = takePointerRequest();
    expect(request?.element).toBe(t);
    expect(request?.trigger).toBe("press");
    t.destroy();
  });

  it("reports its focus state to the Inspector", () => {
    const t = new UISplitText({ children: "hi there", focusable: true });

    expect(t._inspectState()).toEqual({ focused: false, focusable: true });
    getFocusState(t)?._setFocused(true);
    expect(t._inspectState()).toEqual({ focused: true, focusable: true });
    t.destroy();
  });

  it("leaves focus navigation when it is destroyed", () => {
    const t = new UISplitText({ children: "hi there", focusable: true });

    t.destroy();

    expect(getFocusState(t)).toBeUndefined();
  });
});
