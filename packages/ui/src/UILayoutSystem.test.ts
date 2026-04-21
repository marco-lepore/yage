import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
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
    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

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

    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics { return this; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rect(...args: unknown[]): MockGraphics { return this; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    roundRect(...args: unknown[]): MockGraphics { return this; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fill(...args: unknown[]): MockGraphics { return this; }
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    width: number;
    height: number;
    anchor = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };

    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      this.width = 50;
      this.height = 14;
    }
  }

  return { mocks: { MockContainer, MockGraphics, MockText } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
}));

import Yoga from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UIPanel } from "./UIPanel.js";
import { Transform, Vec2 } from "@yagejs/core";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import { UILayoutSystem } from "./UILayoutSystem.js";
import { Anchor } from "./types.js";
import { createUITestContext, spawnEntityInScene } from "./test-helpers.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("UILayoutSystem", () => {
  let system: UILayoutSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    system = new UILayoutSystem();
  });

  function setup() {
    const ctx = createUITestContext();
    system._setContext(ctx.context);
    system.onRegister!(ctx.context);
    return ctx;
  }

  describe("anchor resolution", () => {
    it("positions panel at TopLeft (0,0)", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.TopLeft }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(0);
      expect(panel.container.position.y).toBe(0);
    });

    it("positions panel at Center", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.Center }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      // Panel size = 100x30, virtual = 800x600
      // x = (800 - 100) / 2 = 350
      // y = (600 - 30) / 2 = 285
      expect(panel.container.position.x).toBe(350);
      expect(panel.container.position.y).toBe(285);
    });

    it("positions panel at BottomRight", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.BottomRight }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(700); // 800 - 100
      expect(panel.container.position.y).toBe(570); // 600 - 30
    });

    it("positions panel at TopCenter", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.TopCenter }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(350);
      expect(panel.container.position.y).toBe(0);
    });

    it("positions panel at BottomCenter", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.BottomCenter }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(350);
      expect(panel.container.position.y).toBe(570);
    });

    it("positions panel at CenterLeft", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.CenterLeft }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(0);
      expect(panel.container.position.y).toBe(285);
    });

    it("positions panel at CenterRight", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.CenterRight }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(700);
      expect(panel.container.position.y).toBe(285);
    });

    it("positions panel at TopRight", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.TopRight }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(700);
      expect(panel.container.position.y).toBe(0);
    });

    it("positions panel at BottomLeft", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(new UIPanel({ anchor: Anchor.BottomLeft }));
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      expect(panel.container.position.x).toBe(0);
      expect(panel.container.position.y).toBe(570);
    });
  });

  it("applies offset to anchor position", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    const panel = entity.add(new UIPanel({ anchor: Anchor.TopLeft, offset: { x: 10, y: 20 } }));
    panel.button("A", { width: 100, height: 30 });

    system.update(16);

    expect(panel.container.position.x).toBe(10);
    expect(panel.container.position.y).toBe(20);
  });

  it("uses offset as position when no anchor specified", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    const panel = entity.add(new UIPanel({ offset: { x: 50, y: 100 } }));
    panel.button("A", { width: 100, height: 30 });

    system.update(16);

    expect(panel.container.position.x).toBe(50);
    expect(panel.container.position.y).toBe(100);
  });

  it("skips disabled panels", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    const panel = entity.add(new UIPanel({ anchor: Anchor.Center }));
    panel.button("A", { width: 100, height: 30 });
    panel.enabled = false;

    system.update(16);

    // Position should remain at default (0, 0)
    expect(panel.container.position.x).toBe(0);
    expect(panel.container.position.y).toBe(0);
  });

  it("skips hidden panels", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    const panel = entity.add(new UIPanel({ anchor: Anchor.Center, visible: false }));
    panel.button("A", { width: 100, height: 30 });

    system.update(16);

    expect(panel.container.position.x).toBe(0);
    expect(panel.container.position.y).toBe(0);
  });

  it("handles multiple panels", () => {
    const { scene } = setup();
    const e1 = spawnEntityInScene(scene, "e1");
    const p1 = e1.add(new UIPanel({ anchor: Anchor.TopLeft }));
    p1.button("A", { width: 100, height: 30 });

    const e2 = spawnEntityInScene(scene, "e2");
    const p2 = e2.add(new UIPanel({ anchor: Anchor.BottomRight }));
    p2.button("B", { width: 80, height: 25 });

    system.update(16);

    expect(p1.container.position.x).toBe(0);
    expect(p1.container.position.y).toBe(0);
    expect(p2.container.position.x).toBe(720); // 800 - 80
    expect(p2.container.position.y).toBe(575); // 600 - 25
  });

  describe("transform positioning", () => {
    it("anchors panel's center at the entity Transform (Anchor.Center)", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform({ position: new Vec2(500, 300) }));
      const panel = entity.add(
        new UIPanel({ positioning: "transform", anchor: Anchor.Center }),
      );
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      // Panel 100×30, center pivot → top-left = (500 - 50, 300 - 15) = (450, 285)
      expect(panel.container.position.x).toBe(450);
      expect(panel.container.position.y).toBe(285);
    });

    it("anchors panel's bottom-center at the Transform (health-bar primitive)", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform({ position: new Vec2(200, 150) }));
      const panel = entity.add(
        new UIPanel({
          positioning: "transform",
          anchor: Anchor.BottomCenter,
        }),
      );
      panel.button("A", { width: 60, height: 8 });

      system.update(16);

      // Panel 60×8, bottom-center pivot → top-left = (200 - 30, 150 - 8) = (170, 142)
      expect(panel.container.position.x).toBe(170);
      expect(panel.container.position.y).toBe(142);
    });

    it("adds offset on top of the Transform-anchored position", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform({ position: new Vec2(100, 100) }));
      const panel = entity.add(
        new UIPanel({
          positioning: "transform",
          anchor: Anchor.BottomCenter,
          offset: { x: 0, y: -8 },
        }),
      );
      panel.button("A", { width: 40, height: 6 });

      system.update(16);

      // (100 - 20, 100 - 6) + (0, -8) = (80, 86)
      expect(panel.container.position.x).toBe(80);
      expect(panel.container.position.y).toBe(86);
    });

    it("uses offset alone when no anchor is specified", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform({ position: new Vec2(50, 75) }));
      const panel = entity.add(
        new UIPanel({ positioning: "transform", offset: { x: 5, y: 5 } }),
      );
      panel.button("A", { width: 30, height: 10 });

      system.update(16);

      expect(panel.container.position.x).toBe(55);
      expect(panel.container.position.y).toBe(80);
    });

    it("follows parent Transform via Entity.addChild composition", () => {
      const { scene } = setup();
      const parent = spawnEntityInScene(scene, "parent");
      parent.add(new Transform({ position: new Vec2(400, 200) }));
      const child = spawnEntityInScene(scene, "child-raw");
      // Transform before addChild so `addChild` can _markDirty it.
      child.add(new Transform({ position: new Vec2(0, -24) }));
      parent.addChild("ui", child);
      const panel = child.add(
        new UIPanel({
          positioning: "transform",
          anchor: Anchor.BottomCenter,
        }),
      );
      panel.button("A", { width: 40, height: 6 });

      system.update(16);

      // parent world = (400, 200); child world = (400, 176)
      // bottom-center pivot → (400 - 20, 176 - 6) = (380, 170)
      expect(panel.container.position.x).toBe(380);
      expect(panel.container.position.y).toBe(170);
    });

    it("throws at add time when positioning: 'transform' and no Transform", () => {
      const { scene } = setup();
      const entity = spawnEntityInScene(scene);

      expect(() =>
        entity.add(
          new UIPanel({ positioning: "transform", anchor: Anchor.Center }),
        ),
      ).toThrow(/requires a Transform/);
    });

    it("positioning: 'anchor' on a world-space layer still resolves against the viewport (explicit opt-out)", () => {
      const { scene } = setup();
      const tree = scene._resolveScoped(SceneRenderTreeKey)!;
      tree.ensureLayer({ name: "world-ui", order: 500 });
      const entity = spawnEntityInScene(scene);
      const panel = entity.add(
        new UIPanel({ layer: "world-ui", anchor: Anchor.Center }),
      );
      panel.button("A", { width: 100, height: 30 });

      system.update(16);

      // Default positioning is "anchor" — viewport math applies
      // regardless of the layer's `space`.
      expect(panel.container.position.x).toBe(350);
      expect(panel.container.position.y).toBe(285);
    });
  });
});
