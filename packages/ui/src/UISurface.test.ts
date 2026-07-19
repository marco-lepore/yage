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

  class MockRectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }

  return {
    mocks: {
      MockContainer,
      MockGraphics,
      MockText,
      MockSprite,
      MockNineSliceSprite,
      MockTilingSprite,
      MockRectangle,
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
  Rectangle: mocks.MockRectangle,
}));

import Yoga from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UISurface } from "./UISurface.js";
import { UIPanel } from "./UIPanel.js";
import { SerializableRegistry, getSerializableType } from "@yagejs/core";
import { Anchor } from "./types.js";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import { createUITestContext, spawnEntityInScene } from "./test-helpers.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("UISurface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a panel with default options", () => {
    const panel = new UISurface();
    expect(panel.container).toBeDefined();
    expect(panel.visible).toBe(true);
  });

  it("respects visible: false option", () => {
    const panel = new UISurface({ visible: false });
    expect(panel.visible).toBe(false);
  });

  it("stores anchor and offset", () => {
    const panel = new UISurface({
      anchor: Anchor.Center,
      offset: { x: 10, y: 20 },
    });
    expect(panel._anchor).toBe(Anchor.Center);
    expect(panel._offset).toEqual({ x: 10, y: 20 });
  });

  it("defaults offset to {0,0}", () => {
    const panel = new UISurface();
    expect(panel._offset).toEqual({ x: 0, y: 0 });
  });

  describe("builder methods", () => {
    it(".text() adds a UIText child", () => {
      const panel = new UISurface();
      const text = panel.text("Hello", { fontSize: 24 });
      expect(text).toBeDefined();
      expect(text.visible).toBe(true);
    });

    it(".button() adds a UIButton child", () => {
      const onClick = vi.fn();
      const panel = new UISurface();
      const btn = panel.button("Click Me", { width: 100, height: 40, onClick });
      expect(btn).toBeDefined();
      expect(btn.visible).toBe(true);
    });

    it(".panel() adds a nested child panel", () => {
      const panel = new UISurface();
      const child = panel.panel({ direction: "row", gap: 4 });
      expect(child).toBeDefined();
      expect(child.visible).toBe(true);
    });

    it("nested panels can have their own children", () => {
      const panel = new UISurface();
      const child = panel.panel({ direction: "column" });
      child.text("Nested Text");
      child.button("Nested Btn", { width: 80, height: 30 });
      // Should not throw
    });
  });

  describe("root", () => {
    it("is a UIPanel instance, identity-stable across accesses", () => {
      const surface = new UISurface();
      expect(surface.root).toBeInstanceOf(UIPanel);
      expect(surface.root).toBe(surface.root);
    });

    it("container is the root panel's container", () => {
      const surface = new UISurface();
      expect(surface.container).toBe(surface.root.container);
    });
  });

  describe("serialization", () => {
    it('registers as "UISurface" and round-trips options through the registry', () => {
      expect(getSerializableType(UISurface)).toBe("UISurface");
      expect(SerializableRegistry.get("UISurface")).toBe(UISurface);

      const opts = {
        anchor: Anchor.Center,
        offset: { x: 10, y: 20 },
        gap: 4,
        padding: { top: 2, left: 3 },
      };
      const surface = new UISurface(opts);
      const snapshot = surface.serialize();
      expect(snapshot).toEqual(opts);
      expect(snapshot).not.toBe(opts);

      const ctor = SerializableRegistry.get("UISurface") as typeof UISurface;
      const restored = ctor.fromSnapshot(snapshot);
      expect(restored).toBeInstanceOf(UISurface);
      expect(restored.serialize()).toEqual(opts);
      expect(restored._anchor).toBe(Anchor.Center);
      expect(restored._offset).toEqual({ x: 10, y: 20 });
    });
  });

  describe("setPointerHandlers", () => {
    it("forwards pointer/hover handlers to the underlying node", () => {
      const panel = new UISurface();
      const update = vi.spyOn(panel.root, "update");
      const onHover = vi.fn();
      panel.setPointerHandlers({ onHover });
      // Delegates to the node's element `update` (where PointerEvents picks the
      // handler up). `UISurface.update` can't be used for this — on a Component
      // it's the per-frame lifecycle hook the engine calls.
      expect(update).toHaveBeenCalledWith({ onHover });
    });
  });

  describe("visibility toggle", () => {
    it("toggling visible property works", () => {
      const panel = new UISurface();
      panel.visible = false;
      expect(panel.visible).toBe(false);
      panel.visible = true;
      expect(panel.visible).toBe(true);
    });

    it("nested panel visibility can be toggled", () => {
      const panel = new UISurface();
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
      entity.add(new UISurface());

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
      const panel = entity.add(new UISurface());
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
      entity.add(new UISurface());
      const uiLayer = tree.get("ui");
      expect(uiLayer.space).toBe("screen");
    });

    it("normalizes existing screen-space UI layers to static event mode", () => {
      const { scene } = createUITestContext();
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      tree.ensureLayer({ name: "ui", order: 1000 }, { space: "screen" });
      const entity = spawnEntityInScene(scene);

      entity.add(new UISurface());

      expect(tree.get("ui").container.eventMode).toBe("static");
    });

    it("renders into a pre-declared world-space layer", () => {
      const { scene } = createUITestContext();
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      // Declared on Scene.layers with no `space` override — defaults to
      // "world", meaning cameras transform the layer.
      tree.ensureLayer({ name: "world-ui", order: 500 });
      const entity = spawnEntityInScene(scene);

      entity.add(new UISurface({ layer: "world-ui" }));

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
        entity.add(new UISurface({ positioning: "transform" })),
      ).toThrow(/requires a Transform/);
    });
  });

  describe("layout", () => {
    it("column layout positions children vertically with gap", () => {
      const panel = new UISurface({ direction: "column", gap: 10 });
      panel.button("A", { width: 100, height: 30 });
      panel.button("B", { width: 100, height: 30 });

      // Run Yoga layout (undefined = shrink-to-content)
      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      const children = panel.root.children;
      expect(children[0]!.displayObject.position.y).toBe(0);
      expect(children[1]!.displayObject.position.y).toBe(40);
      expect(panel.root.yogaNode.getComputedHeight()).toBe(70);
    });

    it("row layout positions children horizontally with gap", () => {
      const panel = new UISurface({ direction: "row", gap: 8 });
      panel.button("A", { width: 60, height: 30 });
      panel.button("B", { width: 60, height: 30 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      const children = panel.root.children;
      expect(children[0]!.displayObject.position.x).toBe(0);
      expect(children[1]!.displayObject.position.x).toBe(68);
      expect(panel.root.yogaNode.getComputedWidth()).toBe(128);
    });

    it("padding offsets children", () => {
      const panel = new UISurface({ direction: "column", padding: 20 });
      panel.button("A", { width: 100, height: 30 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      const children = panel.root.children;
      expect(children[0]!.displayObject.position.x).toBe(20);
      expect(children[0]!.displayObject.position.y).toBe(20);
    });

    it("absolute-positioned child resolves against the parent (left/top)", () => {
      const parent = new UISurface({
        direction: "column",
        width: 200,
        height: 200,
      });
      const child = parent.panel({
        position: "absolute",
        left: 10,
        top: 20,
        width: 50,
        height: 30,
      });

      parent.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      parent.root.applyLayout();

      expect(child.displayObject.position.x).toBe(10);
      expect(child.displayObject.position.y).toBe(20);
      expect(child.yogaNode.getComputedWidth()).toBe(50);
      expect(child.yogaNode.getComputedHeight()).toBe(30);
    });

    it("percentage edge offsets resolve against the parent box (tooltip anchor)", () => {
      // The mechanism `<Tooltip>` rides on: a `"100%"` edge offset on an
      // absolute child pins it flush against the parent's far edge with no
      // size measurement. `top: "100%"` ⇒ child's top at the parent's
      // bottom; `right: "100%"` ⇒ child's right at the parent's left.
      const parent = new UISurface({
        direction: "column",
        width: 200,
        height: 120,
      });
      const below = parent.panel({
        position: "absolute",
        top: "100%",
        width: 60,
        height: 24,
      });
      const leftOf = parent.panel({
        position: "absolute",
        right: "100%",
        width: 40,
        height: 16,
      });

      parent.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      parent.root.applyLayout();

      // `top: 100%` of the 120px-tall parent ⇒ y == 120 (flush under it).
      expect(below.displayObject.position.y).toBe(120);
      // `right: 100%` ⇒ the child's right edge sits at the parent's left
      // edge, so its left (rendered x) is -width.
      expect(leftOf.displayObject.position.x).toBe(-40);
    });

    it("alignItems 'stretch' grows short auto children to the widest sibling", () => {
      // The pause-scene pattern: a shrink-to-fit column panel where every
      // button auto-sizes to its label. The widest button defines the
      // panel's content width and the shorter ones grow to match — clean
      // uniform stack without the caller pinning a width.
      const panel = new UISurface({
        direction: "column",
        gap: 4,
        alignItems: "stretch",
      });
      const short = panel.button("OK", {});
      const longer = panel.button("Settings (transparentBelow=false)", {});

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      const longerW = longer.yogaNode.getComputedWidth();
      const shortW = short.yogaNode.getComputedWidth();
      // Both children share the same width — driven by the longer label.
      expect(shortW).toBe(longerW);
      // The panel itself shrank to fit that widest natural width.
      expect(panel.root.yogaNode.getComputedWidth()).toBe(longerW);
    });

    it("partial imperative update on an already-absolute node moves it", () => {
      // Animation / repositioning code typically pokes a single edge
      // without re-specifying `position` each frame. The Yoga node is
      // already Absolute, so the new edge value must still take effect.
      const parent = new UISurface({
        direction: "column",
        width: 200,
        height: 200,
      });
      const child = parent.panel({
        position: "absolute",
        left: 10,
        top: 20,
        width: 40,
        height: 20,
      });

      child.update({ top: 80 });
      parent.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      parent.root.applyLayout();

      expect(child.displayObject.position.x).toBe(10);
      expect(child.displayObject.position.y).toBe(80);
    });

    it("clears stale edge offsets when transitioning from absolute to relative", () => {
      const parent = new UISurface({
        direction: "column",
        width: 200,
        height: 200,
      });
      const child = parent.panel({
        position: "absolute",
        left: 100,
        top: 50,
        width: 40,
        height: 20,
      });

      // First layout — child pinned via absolute positioning.
      parent.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      parent.root.applyLayout();
      expect(child.displayObject.position.x).toBe(100);
      expect(child.displayObject.position.y).toBe(50);

      // Demote to relative. The stale left/top must NOT linger — Yoga
      // applies them as CSS-style flow nudges on a Relative node.
      child.update({ position: "relative" });
      parent.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      parent.root.applyLayout();
      expect(child.displayObject.position.x).toBe(0);
      expect(child.displayObject.position.y).toBe(0);
    });

    it("absolute-positioned child is lifted out of flex flow", () => {
      const parent = new UISurface({
        direction: "column",
        gap: 10,
        width: 200,
      });
      // Two normal children plus an absolute overlay — the overlay should not
      // contribute to the parent's main-axis advance.
      parent.button("A", { width: 100, height: 30 });
      parent.button("B", { width: 100, height: 30 });
      const overlay = parent.panel({
        position: "absolute",
        left: 0,
        top: 0,
        width: 200,
        height: 200,
      });

      parent.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      parent.root.applyLayout();

      const children = parent.root.children;
      // The flex-flow children remain stacked vertically with the original
      // 10px gap — the absolute overlay does not push them around.
      expect(children[0]!.displayObject.position.y).toBe(0);
      expect(children[1]!.displayObject.position.y).toBe(40);
      expect(overlay.displayObject.position.x).toBe(0);
      expect(overlay.displayObject.position.y).toBe(0);
    });

    it("puts the box-sized hitArea on a leaf catcher, not the container", () => {
      // Two regressions guarded at once:
      //  - un-painted dead-zone: a background-less panel with hover/click
      //    handlers must be hit-testable over its whole box — gaps, padding,
      //    the space around shrink-wrapped children — not just where a child
      //    paints.
      //  - overflow prune: Pixi treats a container's hitArea as a subtree prune
      //    gate, so a point outside the box skips the container AND every
      //    descendant. The box-sized hitArea therefore lives on a childless
      //    leaf; on the container it would make a child that renders outside
      //    the box (an open PixiSelect dropdown, a popover) unhittable.
      const panel = new UISurface({
        direction: "column",
        gap: 10,
        padding: 5,
        onHover: vi.fn(),
      });
      panel.button("A", { width: 100, height: 30 });
      panel.button("B", { width: 100, height: 30 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      // The container must NOT carry a hitArea — it would prune descendants
      // that render outside the box.
      expect(
        (panel.container as unknown as { hitArea?: unknown }).hitArea,
      ).toBeUndefined();

      const catcher = (
        panel.root as unknown as {
          _hitCatcher: {
            eventMode: string;
            hitArea: { x: number; y: number; width: number; height: number };
          };
        }
      )._hitCatcher;
      expect(catcher.eventMode).toBe("static");
      const hit = catcher.hitArea;
      expect(hit.x).toBe(0);
      expect(hit.y).toBe(0);
      // 100 wide content + 5px padding each side; two 30px rows + 10px gap +
      // 5px padding each side — the gap/padding region is inside the box.
      expect(hit.width).toBe(panel.root.yogaNode.getComputedWidth());
      expect(hit.height).toBe(panel.root.yogaNode.getComputedHeight());
      expect(hit.width).toBe(110);
      expect(hit.height).toBe(80);
    });

    it("hidden elements are skipped in layout (collapse)", () => {
      const panel = new UISurface({ direction: "column", gap: 10 });
      const a = panel.button("A", { width: 100, height: 30 });
      panel.button("B", { width: 100, height: 30 });
      panel.button("C", { width: 100, height: 30 });

      // Hide the first button
      a.visible = false;

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      const children = panel.root.children;
      // B should be at y=0 (A is hidden via Display.None), C at y=40
      expect(children[1]!.displayObject.position.y).toBe(0);
      expect(children[2]!.displayObject.position.y).toBe(40);
    });
  });

  describe("addElement / removeElement", () => {
    it("addElement adds child to both Pixi and Yoga tree", () => {
      const panel = new UISurface();
      const btn = panel.button("A", { width: 100, height: 30 });
      expect(panel.root.children).toContain(btn);
      expect(panel.root.yogaNode.getChildCount()).toBe(1);
    });

    it("removeElement removes child from both trees", () => {
      const panel = new UISurface();
      const btn = panel.button("A", { width: 100, height: 30 });
      panel.removeElement(btn);
      expect(panel.root.children).not.toContain(btn);
      expect(panel.root.yogaNode.getChildCount()).toBe(0);
    });
  });

  describe("destroy", () => {
    it("frees the yoga node and recurses into children exactly once", () => {
      const panel = new UISurface();
      const child = panel.panel();
      const rootFree = vi.spyOn(panel.root.yogaNode, "free");
      const childFree = vi.spyOn(child.yogaNode, "free");

      panel.root.destroy();

      expect(rootFree).toHaveBeenCalledTimes(1);
      expect(childFree).toHaveBeenCalledTimes(1);
    });

    it("is idempotent — a second call is a no-op", () => {
      const panel = new UISurface();
      const child = panel.panel();
      const rootFree = vi.spyOn(panel.root.yogaNode, "free");
      const childFree = vi.spyOn(child.yogaNode, "free");

      panel.root.destroy();
      panel.root.destroy();

      expect(rootFree).toHaveBeenCalledTimes(1);
      expect(childFree).toHaveBeenCalledTimes(1);
    });
  });

  describe("flex shrink behaviour", () => {
    it("keeps flex children at their natural size by default (Yoga's flexShrink: 0)", () => {
      // Two 80px children in a 100px row want 160px total. With Yoga's raw
      // `flexShrink: 0` default they keep their 80px and overflow the row
      // rather than being crushed — shrinking is opt-in (see below).
      const panel = new UISurface({ direction: "row", width: 100 });
      const a = panel.panel({ width: 80, height: 20 });
      const b = panel.panel({ width: 80, height: 20 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      expect(a.yogaNode.getComputedWidth()).toBe(80);
      expect(b.yogaNode.getComputedWidth()).toBe(80);
    });

    it("shrinks only the child that opts in with flexShrink: 1", () => {
      const panel = new UISurface({ direction: "row", width: 100 });
      const fixed = panel.panel({ width: 80, height: 20 }); // default: no shrink
      const flex = panel.panel({ width: 80, height: 20, flexShrink: 1 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      // `fixed` keeps its 80px; only `flex` absorbs the overflow → 20px.
      expect(fixed.yogaNode.getComputedWidth()).toBe(80);
      expect(flex.yogaNode.getComputedWidth()).toBe(20);
    });

    it("flex shorthand fills the remaining space (grow + shrink:1 + basis:0)", () => {
      // `flex: 1` sizes from a 0 basis, so it takes exactly the space the fixed
      // sibling leaves instead of claiming any content width of its own.
      const panel = new UISurface({ direction: "row", width: 100 });
      const fixed = panel.panel({ width: 30, height: 20 });
      const grow = panel.panel({ height: 20, flex: 1 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      expect(fixed.yogaNode.getComputedWidth()).toBe(30);
      expect(grow.yogaNode.getComputedWidth()).toBe(70); // 100 − 30
    });
  });

  describe("dev-mode overflow warning", () => {
    it("warns once when an in-flow child overflows the content box", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const panel = new UISurface({ direction: "row", width: 100 });
      // flexShrink: 0 + width 200 → can't fit the 100px row, overflows by 100.
      panel.panel({ width: 200, height: 20, flexShrink: 0 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();
      panel.root.applyLayout(); // second pass must not re-warn the same node

      const overflowWarns = warn.mock.calls.filter((c) =>
        String(c[0]).includes("overflows its container"),
      );
      expect(overflowWarns).toHaveLength(1);
      warn.mockRestore();
    });

    it("does not warn when the container clips with overflow: hidden", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const panel = new UISurface({
        direction: "row",
        width: 100,
        overflow: "hidden",
      });
      panel.panel({ width: 200, height: 20, flexShrink: 0 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      const overflowWarns = warn.mock.calls.filter((c) =>
        String(c[0]).includes("overflows its container"),
      );
      expect(overflowWarns).toHaveLength(0);
      warn.mockRestore();
    });

    it("does not warn for an absolute-positioned child outside the box", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const panel = new UISurface({ direction: "row", width: 100, height: 50 });
      panel.panel({ position: "absolute", left: 90, width: 80, height: 20 });

      panel.root.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      panel.root.applyLayout();

      const overflowWarns = warn.mock.calls.filter((c) =>
        String(c[0]).includes("overflows its container"),
      );
      expect(overflowWarns).toHaveLength(0);
      warn.mockRestore();
    });
  });
});
