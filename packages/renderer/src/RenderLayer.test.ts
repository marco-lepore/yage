import { describe, it, expect, vi, beforeEach } from "vitest";

const { MockContainer } = vi.hoisted(() => {
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

    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }
  }
  return { MockContainer };
});

vi.mock("pixi.js", () => ({
  Container: MockContainer,
}));

import { RenderLayer, RenderLayerManager } from "./RenderLayer.js";

describe("RenderLayer", () => {
  it("stores name, order, space, and container", () => {
    const container = { name: "test" } as never;
    const layer = new RenderLayer("bg", 5, "world", container);
    expect(layer.name).toBe("bg");
    expect(layer.order).toBe(5);
    expect(layer.space).toBe("world");
    expect(layer.container).toBe(container);
  });
});

describe("RenderLayerManager", () => {
  let worldRoot: InstanceType<typeof MockContainer>;
  let screenRoot: InstanceType<typeof MockContainer>;
  let manager: RenderLayerManager;

  beforeEach(() => {
    worldRoot = new MockContainer();
    screenRoot = new MockContainer();
    manager = new RenderLayerManager(worldRoot as never, screenRoot as never);
  });

  it("creates a default world-space layer at order 0", () => {
    const def = manager.defaultLayer;
    expect(def.name).toBe("default");
    expect(def.order).toBe(0);
    expect(def.space).toBe("world");
  });

  it("default layer container is added to worldRoot", () => {
    expect(worldRoot.children).toHaveLength(1);
    expect(worldRoot.children[0]).toBe(manager.defaultLayer.container);
  });

  it("creates named world-space layers", () => {
    const ui = manager.create("ui", 100);
    expect(ui.name).toBe("ui");
    expect(ui.order).toBe(100);
    expect(ui.space).toBe("world");
    expect(worldRoot.children).toContain(ui.container);
  });

  it("creates screen-space layers under screenRoot", () => {
    const hud = manager.create("hud", 100, "screen");
    expect(hud.space).toBe("screen");
    expect(screenRoot.children).toContain(hud.container);
    expect(worldRoot.children).not.toContain(hud.container);
  });

  it("get() returns existing layer", () => {
    const ui = manager.create("ui", 100);
    expect(manager.get("ui")).toBe(ui);
  });

  it("get() throws for missing layer", () => {
    expect(() => manager.get("nope")).toThrow('RenderLayer "nope" not found.');
  });

  it("tryGet() returns undefined for missing layer", () => {
    expect(manager.tryGet("nope")).toBeUndefined();
  });

  it("tryGet() returns existing layer", () => {
    const bg = manager.create("bg", -10);
    expect(manager.tryGet("bg")).toBe(bg);
  });

  it("throws on duplicate name", () => {
    manager.create("fg", 10);
    expect(() => manager.create("fg", 20)).toThrow(
      'RenderLayer "fg" already exists.',
    );
  });

  it("getAll() returns layers sorted by order", () => {
    const fg = manager.create("fg", 10);
    const bg = manager.create("bg", -10);
    const all = manager.getAll();
    expect(all[0]).toBe(bg);
    expect(all[1]).toBe(manager.defaultLayer);
    expect(all[2]).toBe(fg);
  });

  it("createFromDef materializes a declarative LayerDef", () => {
    const layer = manager.createFromDef({
      name: "hud",
      order: 100,
      space: "screen",
      sortableChildren: true,
    });
    expect(layer.name).toBe("hud");
    expect(layer.space).toBe("screen");
    expect(layer.container.sortableChildren).toBe(true);
  });

  it("world layers are sorted by zIndex on worldRoot", () => {
    manager.create("fg", 10);
    manager.create("bg", -5);
    const bgLayer = manager.get("bg");
    const defLayer = manager.defaultLayer;
    const fgLayer = manager.get("fg");
    expect((bgLayer.container as unknown as InstanceType<typeof MockContainer>).zIndex).toBe(-5);
    expect((defLayer.container as unknown as InstanceType<typeof MockContainer>).zIndex).toBe(0);
    expect((fgLayer.container as unknown as InstanceType<typeof MockContainer>).zIndex).toBe(10);
  });
});
