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

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    constructor(init: { text: string; style?: Record<string, unknown> }) {
      super();
      this.text = init.text;
      this.style = init.style ?? {};
    }
  }

  return { mocks: { MockContainer, MockText } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Text: mocks.MockText,
}));

import { Transform } from "@yagejs/core";
import { TextComponent } from "./TextComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

describe("TextComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
