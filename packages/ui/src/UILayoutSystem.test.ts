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
});
