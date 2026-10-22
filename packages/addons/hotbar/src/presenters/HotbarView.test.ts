import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";
import { RendererKey, SceneRenderTreeProviderKey } from "@yagejs/renderer";
import type { RendererPlugin, SceneRenderTreeProvider } from "@yagejs/renderer";
import { Hotbar } from "../core/Hotbar.js";
import { HotbarView, defaultHotbarTheme } from "./HotbarView.js";
import type { HotbarTheme } from "./HotbarView.js";

const recorded = vi.hoisted(() => ({
  operations: [] as unknown[][],
  texts: [] as { text: string; style: object; visible: boolean }[],
  styleChanges: 0,
  sprites: [] as { texture: string; visible: boolean }[],
}));
vi.mock("@yagejs/renderer", async () => {
  const { Component, ServiceKey } = await import("@yagejs/core");
  class GraphicsComponent extends Component {
    visible = true;
    draw(fn: (g: object) => void): void {
      const g = {
        clear() {
          recorded.operations.length = 0;
          return g;
        },
        roundRect(...args: unknown[]) {
          recorded.operations.push(["roundRect", ...args]);
          return g;
        },
        rect(...args: unknown[]) {
          recorded.operations.push(["rect", ...args]);
          return g;
        },
        fill(...args: unknown[]) {
          recorded.operations.push(["fill", ...args]);
          return g;
        },
        stroke(...args: unknown[]) {
          recorded.operations.push(["stroke", ...args]);
          return g;
        },
      };
      fn(g);
    }
  }
  class TextComponent extends Component {
    visible = true;
    text: string;
    style: object;
    constructor(options: { text: string; style: object }) {
      super();
      this.text = options.text;
      this.style = options.style;
      recorded.texts.push(this);
    }
    setText(text: string): void {
      this.text = text;
    }
    mergeStyle(style: object): void {
      this.style = { ...this.style, ...style };
      recorded.styleChanges++;
    }
  }
  class SpriteComponent extends Component {
    visible = true;
    texture: string;
    constructor(options: { texture: string }) {
      super();
      this.texture = options.texture;
      recorded.sprites.push(this);
    }
    setTexture(texture: string): void {
      this.texture = texture;
    }
  }
  return {
    GraphicsComponent,
    TextComponent,
    SpriteComponent,
    resolveTextureInput: (key: string) => {
      if (key === "missing") throw new Error(`texture '${key}' not found`);
      return { width: 16, height: 16 };
    },
    RendererKey: new ServiceKey("renderer"),
    SceneRenderTreeProviderKey: new ServiceKey("sceneRenderTreeProvider"),
  };
});

function mount(theme: Partial<HotbarTheme> = {}) {
  recorded.texts.length = 0;
  recorded.sprites.length = 0;
  recorded.styleChanges = 0;
  const { scene, context } = createMockScene();
  const ensureLayer = vi.fn();
  context.register(RendererKey, {
    virtualSize: { width: 800, height: 500 },
  } as RendererPlugin);
  context.register(SceneRenderTreeProviderKey, {
    getTree: () => ({ ensureLayer }),
  } as unknown as SceneRenderTreeProvider);
  const view = new HotbarView(theme);
  view.mount(scene);
  const model = new Hotbar({
    bindings: {
      a: {
        label: "Spell",
        read: () => ({ cooldown: { remaining: 1, ratio: 0.5 }, count: 3 }),
        activate: () => ({ ok: true }),
      },
      b: { label: "Bomb", icon: "bomb", activate: () => ({ ok: true }) },
      c: { label: "Cake", icon: "cake", activate: () => ({ ok: true }) },
      d: { label: "Dud", icon: "missing", activate: () => ({ ok: true }) },
    },
    slots: ["a", "a"],
    slotCount: 2,
  });
  view.setVisible(true);
  view.present(model.inspect());
  return { scene, view, model, ensureLayer };
}

describe("HotbarView", () => {
  it("centers hit areas, excludes gaps and hides pointer targets when disabled", () => {
    const { view, ensureLayer } = mount();
    expect(ensureLayer).toHaveBeenCalledWith({
      name: "hotbar",
      order: 1070,
      space: "screen",
    });
    expect(view.slotAtPoint(320, 390)).toBe(0);
    expect(view.slotAtPoint(400, 390)).toBeUndefined();
    expect(view.slotAtPoint(410, 390)).toBe(1);
    expect(view.slotAtPoint(320, 475)).toBe(0);
    expect(view.slotAtPoint(320, 476)).toBeUndefined();
    view.setVisible(false);
    expect(view.slotAtPoint(320, 390)).toBeUndefined();
    expect(recorded.texts.every((t) => !t.visible)).toBe(true);
    view.dispose();
    expect(view.slotAtPoint(320, 390)).toBeUndefined();
  });

  it("passes every theme field to the view config and uses custom placement, hints and colors", () => {
    const theme: HotbarTheme = {
      x: 20,
      y: 30,
      slotWidth: 120,
      slotHeight: 110,
      gap: 17,
      background: 0x112233,
      border: 0x223344,
      selected: 0x334455,
      cooldown: 0x445566,
      text: 0x556677,
      unavailable: 0x667788,
      fontFamily: "monospace",
      fontSize: 19,
      layer: "custom-bar",
      keyLabels: ["Q", "E"],
    };
    const { view, ensureLayer } = mount(theme);
    for (const key of Object.keys(theme) as (keyof HotbarTheme)[])
      expect(view.theme[key]).toEqual(theme[key]);
    expect(ensureLayer).toHaveBeenCalledWith({
      name: theme.layer,
      order: 1070,
      space: "screen",
    });
    expect(recorded.texts[0]?.text).toBe("Q · Spell ×3\n1.0s");
    expect(recorded.texts[0]?.style).toMatchObject({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      fill: theme.unavailable,
    });
    expect(recorded.operations).toContainEqual([
      "roundRect",
      20,
      30,
      120,
      110,
      6,
    ]);
    expect(recorded.operations).toContainEqual([
      "roundRect",
      157,
      30,
      120,
      110,
      6,
    ]);
    for (const color of [theme.background, theme.cooldown])
      expect(recorded.operations).toContainEqual(["fill", color]);
    for (const color of [theme.selected, theme.border])
      expect(recorded.operations).toContainEqual([
        "stroke",
        { color, width: 2 },
      ]);
    expect(view.slotAtPoint(158, 40)).toBe(1);
  });

  it("destroys its entities and allows a fresh mount", () => {
    const { scene, view, model } = mount();
    const spawned = [...scene.getEntities()];
    view.dispose();
    expect(spawned.every((entity) => entity.isDestroyed)).toBe(true);
    view.mount(scene);
    view.setVisible(true);
    view.present(model.inspect());
    expect(view.slotAtPoint(320, 390)).toBe(0);
    expect(() => view.mount(scene)).toThrow("already mounted");
  });

  it("spawns scene-level entities that no host transform moves", () => {
    const { scene } = mount();
    const spawned = [...scene.getEntities()];
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.every((entity) => entity.parent === null)).toBe(true);
  });

  it("reuses one icon sprite per slot and hides it when the icon goes away", () => {
    const { view, model } = mount();
    model.assign(0, "b");
    view.present(model.inspect());
    model.assign(0, "c");
    view.present(model.inspect());
    expect(recorded.sprites).toHaveLength(1);
    expect(recorded.sprites[0]).toMatchObject({
      texture: "cake",
      visible: true,
    });
    model.assign(0, "a");
    view.present(model.inspect());
    expect(recorded.sprites[0]?.visible).toBe(false);
  });

  it("throws for an unregistered icon key on every frame", () => {
    const { view, model } = mount();
    model.assign(0, "d");
    expect(() => view.present(model.inspect())).toThrow("missing");
    expect(() => view.present(model.inspect())).toThrow("missing");
    expect(recorded.sprites).toHaveLength(0);
  });

  it("fills the cooldown bar by the remaining fraction", () => {
    mount({ x: 0, y: 0 });
    expect(recorded.operations).toContainEqual(["rect", 4, 92, 36, 4]);
  });

  it("keeps defaults for theme fields left out", () => {
    const view = new HotbarView({ slotWidth: 96 });
    expect(view.theme).toEqual({ ...defaultHotbarTheme(), slotWidth: 96 });
  });

  it("changes text styles only when slot availability changes", () => {
    const { view, model } = mount();
    expect(recorded.styleChanges).toBe(2);
    view.present(model.inspect());
    expect(recorded.styleChanges).toBe(2);
    const state = model.inspect();
    view.present({
      ...state,
      slots: state.slots.map((slot) => ({ ...slot, available: true })),
    });
    expect(recorded.styleChanges).toBe(4);
    expect(recorded.texts[0]?.style).toMatchObject({
      fill: defaultHotbarTheme().text,
    });
  });

  it("rejects nonfinite geometry and colors at construction", () => {
    expect(() => new HotbarView({ gap: NaN })).toThrow("gap");
    expect(() => new HotbarView({ text: Infinity })).toThrow("color");
  });
});
