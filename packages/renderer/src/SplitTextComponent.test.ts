import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0 };
    pivot = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    tint = 0xffffff;
    eventMode = "passive";
    parent: MockContainer | null = null;
    zIndex = 0;
    destroyed = false;

    // Local-space geometry box; the identity local transform below maps it
    // straight through, so the world-space facet equals these.
    boundsBox = { x: 0, y: 0, width: 0, height: 0 };

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
      }
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    getLocalBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.boundsBox };
    }
    updateLocalTransform(): void {}
    localTransform = {
      apply(p: { x: number; y: number }): { x: number; y: number } {
        return { x: p.x, y: p.y };
      },
    };
    destroyOpts: unknown;
    destroy(opts?: unknown): void {
      this.destroyed = true;
      this.destroyOpts = opts;
      this.removeFromParent();
    }
  }

  class MockPoint {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    constructor(init?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = init?.text ?? "";
      this.style = init?.style ?? {};
    }
  }
  class MockBitmapText extends MockText {}

  // Minimal SplitText model: split() rebuilds chars/words/lines from `text`.
  // chars = one node per non-space char; words = space-delimited; lines = "\n".
  class MockSplitText extends MockContainer {
    private _text: string;
    style: Record<string, unknown>;
    charAnchor: unknown;
    wordAnchor: unknown;
    lineAnchor: unknown;
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
      this.charAnchor = opts.charAnchor ?? 0;
      this.wordAnchor = opts.wordAnchor ?? 0;
      this.lineAnchor = opts.lineAnchor ?? 0;
      this.autoSplit = opts.autoSplit ?? true;
      this.split();
    }

    split(): void {
      this.splitCalls++;
      this.chars = [...this._text]
        .filter((c) => c !== " " && c !== "\n")
        .map((c) => new MockText({ text: c }));
      this.words = this._text
        .split(/\s+/)
        .filter(Boolean)
        .map(() => new MockContainer());
      this.lines = this._text.split("\n").map(() => new MockContainer());
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

  return {
    mocks: {
      MockContainer,
      MockText,
      MockBitmapText,
      MockSplitText,
      MockSplitBitmapText,
      MockPoint,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Text: mocks.MockText,
  BitmapText: mocks.MockBitmapText,
  SplitText: mocks.MockSplitText,
  SplitBitmapText: mocks.MockSplitBitmapText,
  Point: mocks.MockPoint,
}));

import { Transform } from "@yagejs/core";
import { SplitTextComponent } from "./SplitTextComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

describe("SplitTextComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs a canvas SplitText by default", () => {
    const comp = new SplitTextComponent({ text: "hi there" });
    expect(comp.splitText).toBeInstanceOf(mocks.MockSplitText);
    expect(comp.splitText).not.toBeInstanceOf(mocks.MockSplitBitmapText);
    expect(comp.isBitmap).toBe(false);
  });

  it("constructs a SplitBitmapText when bitmap is set", () => {
    const comp = new SplitTextComponent({ text: "hi", bitmap: true });
    expect(comp.splitText).toBeInstanceOf(mocks.MockSplitBitmapText);
    expect(comp.isBitmap).toBe(true);
  });

  it("bitmap text reads fontFamily / fontSize from style", () => {
    const comp = new SplitTextComponent({
      text: "hi",
      bitmap: true,
      style: { fill: 0xff0000, fontFamily: "PressStart", fontSize: 8 },
    });
    expect(comp.splitText.style).toMatchObject({
      fill: 0xff0000,
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("exposes chars / words / lines from the underlying split object", () => {
    const comp = new SplitTextComponent({ text: "ab cd" });
    expect(comp.chars).toHaveLength(4); // a b c d (space dropped)
    expect(comp.words).toHaveLength(2); // "ab", "cd"
    expect(comp.lines).toHaveLength(1);
  });

  it("setText re-splits (autoSplit on) so chars reflect the new string", () => {
    const comp = new SplitTextComponent({ text: "ab" });
    expect(comp.chars).toHaveLength(2);
    comp.setText("abcd");
    expect(comp.chars).toHaveLength(4);
  });

  it("setStyle replaces the style (font lives in style.fontFamily)", () => {
    const comp = new SplitTextComponent({
      text: "hi",
      bitmap: true,
      style: { fontFamily: "PressStart", fontSize: 8, fill: 0xffcc00 },
    });
    comp.setStyle({ fontFamily: "PressStart", fontSize: 8, fill: 0xff0000 });
    expect(comp.splitText.style).toMatchObject({
      fill: 0xff0000,
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("forwards segment anchors and reflects them via getters/setters", () => {
    const comp = new SplitTextComponent({
      text: "hi",
      charAnchor: 0.5,
      lineAnchor: { x: 1, y: 0 },
    });
    expect(comp.charAnchor).toBe(0.5);
    expect(comp.lineAnchor).toEqual({ x: 1, y: 0 });
    comp.wordAnchor = { x: 0, y: 1 };
    expect(comp.splitText.wordAnchor).toEqual({ x: 0, y: 1 });
  });

  it("anchors the whole text block from its local bounds", () => {
    const comp = new SplitTextComponent({
      text: "hi",
      anchor: { x: 0.5, y: 1 },
    });
    const split = comp.splitText as unknown as InstanceType<
      typeof mocks.MockSplitText
    >;
    split.boundsBox = { x: 4, y: 6, width: 80, height: 20 };

    comp.resplit();

    expect(split.pivot).toMatchObject({ x: 44, y: 26 });
  });

  it("recomputes the block anchor after text, style, and manual split changes", () => {
    const comp = new SplitTextComponent({
      text: "hi",
      anchor: { x: 1, y: 0.5 },
    });
    const split = comp.splitText as unknown as InstanceType<
      typeof mocks.MockSplitText
    >;

    split.boundsBox = { x: 0, y: 0, width: 20, height: 10 };
    comp.setText("hello");
    expect(split.pivot).toMatchObject({ x: 20, y: 5 });

    split.boundsBox = { x: 2, y: 4, width: 50, height: 16 };
    comp.setStyle({ fontSize: 24 });
    expect(split.pivot).toMatchObject({ x: 52, y: 12 });

    split.boundsBox = { x: -3, y: 1, width: 30, height: 8 };
    comp.resplit();
    expect(split.pivot).toMatchObject({ x: 27, y: 5 });
  });

  it("sets visibility, tint, and alpha when provided", () => {
    const comp = new SplitTextComponent({
      text: "x",
      visible: false,
      tint: 0x00ff00,
      alpha: 0.25,
    });
    expect(comp.splitText.visible).toBe(false);
    expect(comp.tint).toBe(0x00ff00);
    expect(comp.alpha).toBe(0.25);
  });

  it("applies the interactive option, defaulting eventMode to static", () => {
    const comp = new SplitTextComponent({ text: "x", interactive: {} });
    expect(comp.splitText.eventMode).toBe("static");
  });

  it("supports the shared mask/effects surface", () => {
    const comp = new SplitTextComponent({ text: "x" });
    expect(comp.fx).toBeDefined();
    expect(comp.mask).toBeUndefined();
    expect(typeof comp.setMask).toBe("function");
    expect(typeof comp.clearMask).toBe("function");
  });

  it("resplit() calls the underlying split()", () => {
    const comp = new SplitTextComponent({ text: "hi", autoSplit: false });
    const split = comp.splitText as unknown as InstanceType<
      typeof mocks.MockSplitText
    >;
    const before = split.splitCalls;
    comp.resplit();
    expect(split.splitCalls).toBe(before + 1);
  });

  it("onAdd attaches the split text to the requested layer container", () => {
    const { scene, layerManager } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new SplitTextComponent({ text: "x" }));

    const layerContainer = layerManager.defaultLayer
      .container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.splitText);
  });

  it("onDestroy removes the split text from its parent and destroys it", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new SplitTextComponent({ text: "x" }));

    const obj = comp.splitText as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(obj.parent).not.toBeNull();
    comp.onDestroy?.();
    expect(obj.parent).toBeNull();
    expect(obj.destroyed).toBe(true);
    // segment children freed too, not leaked
    expect((obj as unknown as { destroyOpts?: unknown }).destroyOpts).toEqual({
      children: true,
    });
  });

  it("serialize/fromSnapshot round-trips text, style, bitmap, anchors, layer", () => {
    const comp = new SplitTextComponent({
      text: "score",
      layer: "hud",
      style: { fontSize: 16, fontFamily: "PressStart" },
      bitmap: true,
      anchor: { x: 0.5, y: 1 },
      charAnchor: 0.5,
      autoSplit: false,
      tint: 0x123456,
      alpha: 0.7,
      visible: false,
    });
    const data = comp.serialize();
    expect(data).toMatchObject({
      text: "score",
      layer: "hud",
      style: { fontSize: 16, fontFamily: "PressStart" },
      bitmap: true,
      anchor: { x: 0.5, y: 1 },
      charAnchor: 0.5,
      autoSplit: false,
      tint: 0x123456,
      alpha: 0.7,
      visible: false,
    });

    const restored = SplitTextComponent.fromSnapshot(data);
    expect(restored.splitText).toBeInstanceOf(mocks.MockSplitBitmapText);
    expect(restored.splitText.text).toBe("score");
    expect(restored.serialize().anchor).toEqual({ x: 0.5, y: 1 });
    expect(restored.charAnchor).toBe(0.5);
    expect(restored.tint).toBe(0x123456);
  });

  it("serialize emits style as a POJO that survives JSON round-trip", () => {
    const comp = new SplitTextComponent({
      text: "x",
      style: { fontSize: 16, fill: 0xff0000 },
    });
    const data = comp.serialize();
    const json = JSON.parse(JSON.stringify(data)) as {
      style?: Record<string, unknown>;
    };
    expect(json.style).toEqual({ fontSize: 16, fill: 0xff0000 });
  });

  it("decouples the cached style from the caller's options object", () => {
    const style: { fontSize: number; fill?: number } = { fontSize: 14 };
    const comp = new SplitTextComponent({ text: "x", style });
    style.fontSize = 99;
    style.fill = 0xff0000;
    expect(comp.serialize().style).toEqual({ fontSize: 14 });
  });

  it("decouples a cached object-form anchor from the caller's object", () => {
    const charAnchor = { x: 0.5, y: 0.5 };
    const comp = new SplitTextComponent({ text: "x", charAnchor });
    charAnchor.x = 0.1;
    charAnchor.y = 0.9;
    expect(comp.serialize().charAnchor).toEqual({ x: 0.5, y: 0.5 });
  });

  it("decouples the block anchor from caller and snapshot mutation", () => {
    const anchor = { x: 0.5, y: 1 };
    const comp = new SplitTextComponent({ text: "x", anchor });
    anchor.x = 0;
    const snapshot = comp.serialize();
    expect(snapshot.anchor).toEqual({ x: 0.5, y: 1 });

    if (!snapshot.anchor) throw new Error("Expected a serialized block anchor.");
    snapshot.anchor.y = 0;
    expect(comp.serialize().anchor).toEqual({ x: 0.5, y: 1 });
  });

  it("decouples the serialized anchor from the cache (mutating the snapshot)", () => {
    const comp = new SplitTextComponent({
      text: "x",
      charAnchor: { x: 0.5, y: 0.5 },
    });
    const snap = comp.serialize().charAnchor as { x: number; y: number };
    snap.x = 0.1;
    snap.y = 0.9;
    expect(comp.serialize().charAnchor).toEqual({ x: 0.5, y: 0.5 });
  });

  describe("inspectRender", () => {
    it("reports world-space bounds, visibility, and per-glyph state", () => {
      const comp = new SplitTextComponent({ text: "abc" });
      const split = comp.splitText as unknown as InstanceType<
        typeof mocks.MockSplitText
      >;
      split.boundsBox = { x: 10, y: 20, width: 30, height: 12 };

      const facet = comp.inspectRender();
      expect(facet.bounds).toEqual({ x: 10, y: 20, width: 30, height: 12 });
      expect(facet.visible).toBe(true);
      expect(facet.glyphs).toEqual([
        { visible: true },
        { visible: true },
        { visible: true },
      ]);
      expect(facet.visibleText).toBe("abc");
    });

    it("reflects a typewriter reveal after toggling chars[i].visible", () => {
      const comp = new SplitTextComponent({ text: "Hello" });
      comp.chars.forEach((char, i) => (char.visible = i < 3));

      const facet = comp.inspectRender();
      expect(facet.glyphs).toEqual([
        { visible: true },
        { visible: true },
        { visible: true },
        { visible: false },
        { visible: false },
      ]);
      expect(facet.visibleText).toBe("Hel");
    });
  });
});
