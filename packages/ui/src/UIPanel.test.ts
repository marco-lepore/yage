import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Direction } from "yoga-layout";

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
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    eventMode = "auto";
    cursor = "default";
    mask: MockContainer | null = null;
    maskInverse = false;
    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    setMask(opts: { mask: MockContainer | null; inverse?: boolean }): void {
      this.mask = opts.mask;
      this.maskInverse = opts.inverse ?? false;
    }

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    addChildAt(child: MockContainer, index: number): MockContainer {
      this.children.splice(index, 0, child);
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

    on(event: string, fn: (...args: unknown[]) => void): void {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rect(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    roundRect(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fill(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    stroke(...args: unknown[]): MockGraphics {
      return this;
    }
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    width: number;
    height: number;
    anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      this.width =
        ((opts?.style?.fontSize as number) ?? 14) * this.text.length * 0.5;
      this.height = (opts?.style?.fontSize as number) ?? 14;
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    tint = 0xffffff;
    anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

    constructor(texture?: unknown) {
      super();
      this.texture = texture;
    }
  }

  class MockNineSliceSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    leftWidth = 0;
    topHeight = 0;
    rightWidth = 0;
    bottomHeight = 0;

    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) {
        this.texture = opts.texture;
        this.leftWidth = (opts.leftWidth as number) ?? 0;
        this.topHeight = (opts.topHeight as number) ?? 0;
        this.rightWidth = (opts.rightWidth as number) ?? 0;
        this.bottomHeight = (opts.bottomHeight as number) ?? 0;
      }
    }
  }

  class MockTilingSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    tileScale = {
      x: 1,
      y: 1,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    tilePosition = { x: 0, y: 0 };

    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) {
        this.texture = opts.texture;
        this.width = (opts.width as number) ?? 0;
        this.height = (opts.height as number) ?? 0;
      }
    }
  }

  return {
    mocks: {
      MockContainer,
      MockGraphics,
      MockText,
      MockSprite,
      MockNineSliceSprite,
      MockTilingSprite,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

import Yoga from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UIPanel } from "./UIPanel.js";
import { Anchor } from "./types.js";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import { createUITestContext, spawnEntityInScene } from "./test-helpers.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("UIPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a panel with default options", () => {
    const panel = new UIPanel();
    expect(panel.container).toBeDefined();
    expect(panel.visible).toBe(true);
  });

  it("respects visible: false option", () => {
    const panel = new UIPanel({ visible: false });
    expect(panel.visible).toBe(false);
  });

  it("stores anchor and offset", () => {
    const panel = new UIPanel({
      anchor: Anchor.Center,
      offset: { x: 10, y: 20 },
    });
    expect(panel._anchor).toBe(Anchor.Center);
    expect(panel._offset).toEqual({ x: 10, y: 20 });
  });

  it("defaults offset to {0,0}", () => {
    const panel = new UIPanel();
    expect(panel._offset).toEqual({ x: 0, y: 0 });
  });

  describe("builder methods", () => {
    it(".text() adds a UIText child", () => {
      const panel = new UIPanel();
      const text = panel.text("Hello", { fontSize: 24 });
      expect(text).toBeDefined();
      expect(text.visible).toBe(true);
    });

    it(".button() adds a UIButton child", () => {
      const onClick = vi.fn();
      const panel = new UIPanel();
      const btn = panel.button("Click Me", { width: 100, height: 40, onClick });
      expect(btn).toBeDefined();
      expect(btn.visible).toBe(true);
    });

    it(".panel() adds a nested child panel", () => {
      const panel = new UIPanel();
      const child = panel.panel({ direction: "row", gap: 4 });
      expect(child).toBeDefined();
      expect(child.visible).toBe(true);
    });

    it("nested panels can have their own children", () => {
      const panel = new UIPanel();
      const child = panel.panel({ direction: "column" });
      child.text("Nested Text");
      child.button("Nested Btn", { width: 80, height: 30 });
      // Should not throw
    });
  });

  describe("visibility toggle", () => {
    it("toggling visible property works", () => {
      const panel = new UIPanel();
      panel.visible = false;
      expect(panel.visible).toBe(false);
      panel.visible = true;
      expect(panel.visible).toBe(true);
    });

    it("nested panel visibility can be toggled", () => {
      const panel = new UIPanel();
      const child = panel.panel({ visible: false });
      expect(child.visible).toBe(false);
      child.visible = true;
      expect(child.visible).toBe(true);
    });
  });

  describe("onAdd / onDestroy", () => {
    it("onAdd adds container to the auto-provisioned 'ui' layer", () => {
      const { scene } = createUITestContext();
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      const entity = spawnEntityInScene(scene);
      entity.add(new UIPanel());

      const uiLayer = tree.tryGet("ui");
      expect(uiLayer).toBeDefined();
      const container = (
        uiLayer as unknown as { container: { children: unknown[] } }
      ).container;
      expect(container.children.length).toBe(1);
    });

    it("onDestroy removes container from parent", () => {
      const { scene } = createUITestContext();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel());
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      const uiLayer = tree.tryGet("ui");
      const container = (
        uiLayer as unknown as { container: { children: unknown[] } }
      ).container;

      expect(container.children.length).toBe(1);
      panel.onDestroy!();
      expect(container.children.length).toBe(0);
    });

    it("auto-provisioned 'ui' layer is screen-space", () => {
      const { scene } = createUITestContext();
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      const entity = spawnEntityInScene(scene);
      entity.add(new UIPanel());
      const uiLayer = tree.get("ui");
      expect(uiLayer.space).toBe("screen");
    });

    it("normalizes existing screen-space UI layers to static event mode", () => {
      const { scene } = createUITestContext();
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      tree.ensureLayer({ name: "ui", order: 1000 }, { space: "screen" });
      const entity = spawnEntityInScene(scene);

      entity.add(new UIPanel());

      expect(tree.get("ui").container.eventMode).toBe("static");
    });

    it("renders into a pre-declared world-space layer", () => {
      const { scene } = createUITestContext();
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      // Declared on Scene.layers with no `space` override — defaults to
      // "world", meaning cameras transform the layer.
      tree.ensureLayer({ name: "world-ui", order: 500 });
      const entity = spawnEntityInScene(scene);

      entity.add(new UIPanel({ layer: "world-ui" }));

      const layer = tree.get("world-ui");
      expect(layer.space).toBe("world");
      const container = (
        layer as unknown as { container: { children: unknown[] } }
      ).container;
      expect(container.children.length).toBe(1);
    });

    it("throws when positioning: 'transform' and the entity has no Transform", () => {
      const { scene } = createUITestContext();
      const entity = spawnEntityInScene(scene);

      expect(() =>
        entity.add(new UIPanel({ positioning: "transform" })),
      ).toThrow(/requires a Transform/);
    });
  });

  describe("layout", () => {
    it("column layout positions children vertically with gap", () => {
      const panel = new UIPanel({ direction: "column", gap: 10 });
      panel.button("A", { width: 100, height: 30 });
      panel.button("B", { width: 100, height: 30 });

      // Run Yoga layout (undefined = shrink-to-content)
      panel._node.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel._node.applyLayout();

      const children = panel._node.children;
      expect(children[0]!.displayObject.position.y).toBe(0);
      expect(children[1]!.displayObject.position.y).toBe(40);
      expect(panel._node.yogaNode.getComputedHeight()).toBe(70);
    });

    it("row layout positions children horizontally with gap", () => {
      const panel = new UIPanel({ direction: "row", gap: 8 });
      panel.button("A", { width: 60, height: 30 });
      panel.button("B", { width: 60, height: 30 });

      panel._node.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel._node.applyLayout();

      const children = panel._node.children;
      expect(children[0]!.displayObject.position.x).toBe(0);
      expect(children[1]!.displayObject.position.x).toBe(68);
      expect(panel._node.yogaNode.getComputedWidth()).toBe(128);
    });

    it("padding offsets children", () => {
      const panel = new UIPanel({ direction: "column", padding: 20 });
      panel.button("A", { width: 100, height: 30 });

      panel._node.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel._node.applyLayout();

      const children = panel._node.children;
      expect(children[0]!.displayObject.position.x).toBe(20);
      expect(children[0]!.displayObject.position.y).toBe(20);
    });

    it("hidden elements are skipped in layout (collapse)", () => {
      const panel = new UIPanel({ direction: "column", gap: 10 });
      const a = panel.button("A", { width: 100, height: 30 });
      panel.button("B", { width: 100, height: 30 });
      panel.button("C", { width: 100, height: 30 });

      // Hide the first button
      a.visible = false;

      panel._node.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel._node.applyLayout();

      const children = panel._node.children;
      // B should be at y=0 (A is hidden via Display.None), C at y=40
      expect(children[1]!.displayObject.position.y).toBe(0);
      expect(children[2]!.displayObject.position.y).toBe(40);
    });
  });

  describe("addElement / removeElement", () => {
    it("addElement adds child to both Pixi and Yoga tree", () => {
      const panel = new UIPanel();
      const btn = panel.button("A", { width: 100, height: 30 });
      expect(panel._node.children).toContain(btn);
      expect(panel._node.yogaNode.getChildCount()).toBe(1);
    });

    it("removeElement removes child from both trees", () => {
      const panel = new UIPanel();
      const btn = panel.button("A", { width: 100, height: 30 });
      panel.removeElement(btn);
      expect(panel._node.children).not.toContain(btn);
      expect(panel._node.yogaNode.getChildCount()).toBe(0);
    });
  });
});
