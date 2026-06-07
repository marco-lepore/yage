import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    tint = 0xffffff;
    anchor = {
      x: 0,
      y: 0,
      set: vi.fn(function (
        this: { x: number; y: number },
        ax: number,
        ay: number,
      ) {
        this.x = ax;
        this.y = ay;
      }),
    };

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

    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }

    boundsBox = { x: 0, y: 0, width: 0, height: 0 };

    getLocalBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.boundsBox };
    }

    updateLocalTransform(): void {}

    // Identity local transform → world bounds equal the local box, so the facet
    // assertions below read straight through. renderFacet.test.ts covers the
    // non-identity (zoom / rotation) mapping math against a real Pixi Matrix.
    localTransform = {
      apply(p: { x: number; y: number }): { x: number; y: number } {
        return { x: p.x, y: p.y };
      },
    };

    destroy(): void {
      this.destroyed = true;
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
    resolution: number | undefined;
    constructor(init: {
      text: string;
      style?: Record<string, unknown>;
      resolution?: number;
    }) {
      super();
      this.text = init.text;
      this.style = init.style ?? {};
      this.resolution = init.resolution;
    }
  }

  // Distinct subclass so tests can assert which Pixi class was constructed.
  class MockBitmapText extends MockText {}

  return { mocks: { MockContainer, MockText, MockBitmapText, MockPoint } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Text: mocks.MockText,
  BitmapText: mocks.MockBitmapText,
  Point: mocks.MockPoint,
}));

import { Transform } from "@yagejs/core";
import { TextComponent } from "./TextComponent.js";
import { setDefaultTextStyle } from "./internal/textConstruction.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

describe("TextComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultTextStyle(undefined);
  });

  it("creates a pixi Text with the supplied content", () => {
    const comp = new TextComponent({ text: "hello" });
    expect(comp.text).toBeDefined();
    expect(comp.text.text).toBe("hello");
  });

  it("defaults to 'default' layer", () => {
    const comp = new TextComponent({ text: "x" });
    expect(comp.layerName).toBe("default");
  });

  it("accepts a custom layer name", () => {
    const comp = new TextComponent({ text: "x", layer: "hud" });
    expect(comp.layerName).toBe("hud");
  });

  it("forwards style options to the underlying Text", () => {
    const comp = new TextComponent({
      text: "x",
      style: { fontSize: 14, fill: 0xff0000 },
    });
    expect(comp.text.style).toEqual({ fontSize: 14, fill: 0xff0000 });
  });

  it("sets anchor when provided", () => {
    const comp = new TextComponent({
      text: "x",
      anchor: { x: 0.5, y: 1 },
    });
    expect(comp.text.anchor.set).toHaveBeenCalledWith(0.5, 1);
  });

  it("sets visibility, tint, and alpha when provided", () => {
    const comp = new TextComponent({
      text: "x",
      visible: false,
      tint: 0x00ff00,
      alpha: 0.25,
    });
    expect(comp.text.visible).toBe(false);
    expect(comp.text.tint).toBe(0x00ff00);
    expect(comp.text.alpha).toBe(0.25);
  });

  it("setText updates the underlying Text content", () => {
    const comp = new TextComponent({ text: "old" });
    comp.setText("new");
    expect(comp.text.text).toBe("new");
  });

  it("setStyle replaces the underlying Text style", () => {
    const comp = new TextComponent({ text: "x", style: { fontSize: 10 } });
    comp.setStyle({ fontSize: 20 });
    expect(comp.text.style).toEqual({ fontSize: 20 });
  });

  it("tint and alpha setters update the underlying Text", () => {
    const comp = new TextComponent({ text: "x" });
    comp.tint = 0xabcdef;
    comp.alpha = 0.5;
    expect(comp.text.tint).toBe(0xabcdef);
    expect(comp.text.alpha).toBe(0.5);
    expect(comp.tint).toBe(0xabcdef);
    expect(comp.alpha).toBe(0.5);
  });

  it("onAdd attaches the Text to the requested layer container", () => {
    const { scene, layerManager } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new TextComponent({ text: "x" }));

    const layerContainer = layerManager.defaultLayer
      .container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.text);
  });

  it("onDestroy removes the Text from its parent and destroys it", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new TextComponent({ text: "x" }));

    const txt = comp.text as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(txt.parent).not.toBeNull();

    comp.onDestroy?.();
    expect(txt.parent).toBeNull();
    expect(txt.destroyed).toBe(true);
  });

  it("serialize/fromSnapshot round-trips text, layer, tint, alpha, anchor, visible", () => {
    const comp = new TextComponent({
      text: "hello",
      layer: "hud",
      tint: 0x123456,
      alpha: 0.7,
      anchor: { x: 0.5, y: 0.5 },
      visible: false,
      style: { fontSize: 16 },
    });

    const data = comp.serialize();
    expect(data).toMatchObject({
      text: "hello",
      layer: "hud",
      tint: 0x123456,
      alpha: 0.7,
      anchor: { x: 0.5, y: 0.5 },
      visible: false,
    });

    const restored = TextComponent.fromSnapshot(data);
    expect(restored.text.text).toBe("hello");
    expect(restored.layerName).toBe("hud");
    expect(restored.text.tint).toBe(0x123456);
    expect(restored.text.alpha).toBe(0.7);
    expect(restored.text.anchor.set).toHaveBeenCalledWith(0.5, 0.5);
    expect(restored.text.visible).toBe(false);
  });

  it("serialize emits the original style options as a POJO that survives JSON round-trip", () => {
    // Pixi's live Text.style is a class instance with getters, not a POJO.
    // We must serialize the raw options we were given, so a JSON.stringify
    // pass (as the save system does) preserves the style intact.
    const comp = new TextComponent({
      text: "x",
      style: { fontSize: 16, fill: 0xff0000, fontFamily: "monospace" },
    });
    const data = comp.serialize();
    const jsonRoundTripped = JSON.parse(JSON.stringify(data)) as {
      style?: { fontSize?: number; fill?: number; fontFamily?: string };
    };
    expect(jsonRoundTripped.style).toEqual({
      fontSize: 16,
      fill: 0xff0000,
      fontFamily: "monospace",
    });
  });

  it("setStyle updates the options snapshot used by serialize", () => {
    const comp = new TextComponent({
      text: "x",
      style: { fontSize: 10 },
    });
    comp.setStyle({ fontSize: 22, fill: 0x00ff00 });
    const data = comp.serialize();
    expect(data.style).toEqual({ fontSize: 22, fill: 0x00ff00 });
  });

  it("omits style from the snapshot when none was provided", () => {
    const comp = new TextComponent({ text: "x" });
    const data = comp.serialize();
    expect(data.style).toBeUndefined();
  });

  it("decouples the cached style from the caller's options object", () => {
    const style: { fontSize: number; fill?: number } = { fontSize: 14 };
    const comp = new TextComponent({ text: "x", style });

    // Caller mutates their original options object after construction.
    style.fontSize = 99;
    style.fill = 0xff0000;

    const data = comp.serialize();
    expect(data.style).toEqual({ fontSize: 14 });
  });

  it("returns a fresh style object on each serialize() call", () => {
    const comp = new TextComponent({
      text: "x",
      style: { fontSize: 14 },
    });
    const a = comp.serialize();
    const b = comp.serialize();
    expect(a.style).not.toBe(b.style);
    expect(a.style).toEqual(b.style);
  });

  it("applies the engine default text style as a base, per-text style wins", () => {
    setDefaultTextStyle({ fontFamily: "Inter", fill: 0x111111 });
    const comp = new TextComponent({ text: "x", style: { fill: 0xff0000 } });
    expect(comp.text.style).toEqual({ fontFamily: "Inter", fill: 0xff0000 });
  });

  it("keeps the engine default under a recolour via setStyle", () => {
    setDefaultTextStyle({ fontFamily: "Inter" });
    const comp = new TextComponent({ text: "x", style: { fill: 0xff0000 } });
    comp.setStyle({ fill: 0x00ff00 });
    expect(comp.text.style).toEqual({ fontFamily: "Inter", fill: 0x00ff00 });
  });

  it("constructs a canvas Text by default", () => {
    const comp = new TextComponent({ text: "x" });
    expect(comp.text).toBeInstanceOf(mocks.MockText);
    expect(comp.text).not.toBeInstanceOf(mocks.MockBitmapText);
  });

  it("constructs a BitmapText when bitmap: true", () => {
    const comp = new TextComponent({ text: "x", bitmap: true });
    expect(comp.text).toBeInstanceOf(mocks.MockBitmapText);
  });

  it("bitmap text reads fontFamily / fontSize from style", () => {
    const comp = new TextComponent({
      text: "x",
      bitmap: true,
      style: { fill: 0xff0000, fontFamily: "PressStart", fontSize: 16 },
    });
    expect(comp.text).toBeInstanceOf(mocks.MockBitmapText);
    expect(comp.text.style).toMatchObject({
      fill: 0xff0000,
      fontFamily: "PressStart",
      fontSize: 16,
    });
  });

  it("setStyle on a bitmap text honours fontWeight via the variant registry", async () => {
    const {
      registerBitmapFontVariant,
      clearBitmapFontVariants,
    } = await import("./internal/bitmapFontVariants.js");
    clearBitmapFontVariants();
    try {
      registerBitmapFontVariant("Body", {}, "Body");
      registerBitmapFontVariant("Body", { fontWeight: "bold" }, "Body bold");

      const comp = new TextComponent({
        text: "x",
        bitmap: true,
        style: { fontFamily: "Body", fontSize: 12 },
      });
      expect(comp.text.style).toMatchObject({ fontFamily: "Body" });

      comp.setStyle({ fontFamily: "Body", fontSize: 12, fontWeight: "bold" });
      // setStyle has to route through buildTextOptions so the variant redirect
      // runs on the update path — otherwise emphasis silently lands on the base
      // atlas after construction.
      expect(comp.text.style).toMatchObject({ fontFamily: "Body bold" });
      // fontWeight is dropped on the redirect (the variant atlas already baked
      // its emphasis; Pixi resolves bitmap fonts by family-name alone).
      expect(
        (comp.text.style as { fontWeight?: string }).fontWeight,
      ).toBeUndefined();
    } finally {
      // The registry is process-global — restore it even if an assertion above
      // throws, so a failure here doesn't poison later tests.
      clearBitmapFontVariants();
    }
  });

  it("mergeStyle keeps the existing font/size on an imperative recolour", () => {
    const comp = new TextComponent({
      text: "score",
      bitmap: true,
      style: { fontFamily: "PressStart", fontSize: 16, fill: 0xffcc00 },
    });
    comp.mergeStyle({ fill: 0xff0000 });
    expect(comp.text.style).toMatchObject({
      fill: 0xff0000,
      fontFamily: "PressStart",
      fontSize: 16,
    });
  });

  it("warns when `bitmap` is nested in style on the setStyle path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const comp = new TextComponent({ text: "x" });
    comp.setStyle({ fill: 0xff0000, bitmap: true } as never);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("`bitmap` was found inside `style`"),
    );
    warn.mockRestore();
  });

  it("setStyle replaces — properties not passed drop away", () => {
    const comp = new TextComponent({
      text: "x",
      style: { fontSize: 10, fontFamily: "Foo" },
    });
    comp.setStyle({ fontSize: 20, fill: 0x00ff00 });
    expect(comp.text.style).toEqual({ fontSize: 20, fill: 0x00ff00 });
  });

  it("forwards resolution to a canvas Text constructor", () => {
    const comp = new TextComponent({ text: "x", resolution: 3 });
    expect(
      (comp.text as unknown as { resolution?: number }).resolution,
    ).toBe(3);
  });

  it("does NOT forward resolution to a BitmapText (font-managed in v8)", () => {
    const comp = new TextComponent({
      text: "x",
      bitmap: true,
      resolution: 3,
    });
    expect(comp.text).toBeInstanceOf(mocks.MockBitmapText);
    expect(
      (comp.text as unknown as { resolution?: number }).resolution,
    ).toBeUndefined();
  });

  it("serialize/fromSnapshot round-trips bitmap and resolution", () => {
    const comp = new TextComponent({
      text: "hi",
      bitmap: true,
      style: { fontFamily: "PressStart", fontSize: 8 },
      resolution: 2,
    });
    const data = comp.serialize();
    expect(data.bitmap).toBe(true);
    expect(data.resolution).toBe(2);

    const restored = TextComponent.fromSnapshot(data);
    expect(restored.text).toBeInstanceOf(mocks.MockBitmapText);
    expect(restored.text.style).toMatchObject({
      fontFamily: "PressStart",
      fontSize: 8,
    });
  });

  it("decouples the cached style snapshot from the caller's object", () => {
    const style: { fill: number; fontFamily?: string } = { fill: 0xffffff };
    const comp = new TextComponent({ text: "x", style });
    style.fill = 0x000000;
    style.fontFamily = "B";
    expect(comp.serialize().style).toEqual({ fill: 0xffffff });
  });

  it("omits bitmap and resolution from the snapshot when not provided", () => {
    const data = new TextComponent({ text: "x" }).serialize();
    expect(data.bitmap).toBeUndefined();
    expect(data.resolution).toBeUndefined();
  });

  describe("inspectRender", () => {
    it("reports world-space bounds and local visibility", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const comp = entity.add(new TextComponent({ text: "score" }));
      const text = comp.text as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      text.boundsBox = { x: 2, y: 3, width: 50, height: 18 };

      const facet = comp.inspectRender();
      expect(facet.bounds).toEqual({ x: 2, y: 3, width: 50, height: 18 });
      expect(facet.visible).toBe(true);
    });

    it("reflects a visibility toggle", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const comp = entity.add(new TextComponent({ text: "x", visible: false }));
      const text = comp.text as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      text.boundsBox = { x: 0, y: 0, width: 8, height: 8 };

      const facet = comp.inspectRender();
      expect(facet.visible).toBe(false);
      // Geometry-truthful: a hidden-but-sized object still reports its real box;
      // `bounds: null` is reserved for genuinely empty geometry.
      expect(facet.bounds).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    });
  });
});
