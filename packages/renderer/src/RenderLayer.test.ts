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
  it("stores name, order, and container", () => {
    const container = { name: "test" } as never;
    const layer = new RenderLayer("bg", 5, container);
    expect(layer.name).toBe("bg");
    expect(layer.order).toBe(5);
    expect(layer.container).toBe(container);
  });
});

describe("RenderLayerManager", () => {
  let stage: InstanceType<typeof MockContainer>;
  let manager: RenderLayerManager;

  beforeEach(() => {
    stage = new MockContainer();
    manager = new RenderLayerManager(stage as never);
  });

  it("creates a default layer at order 0", () => {
    const def = manager.defaultLayer;
    expect(def.name).toBe("default");
    expect(def.order).toBe(0);
  });

  it("default layer container is added to stage", () => {
    expect(stage.children).toHaveLength(1);
    expect(stage.children[0]).toBe(manager.defaultLayer.container);
  });

  it("creates named layers", () => {
    const ui = manager.create("ui", 100);
    expect(ui.name).toBe("ui");
    expect(ui.order).toBe(100);
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

  it("containers are added to stage as children", () => {
    manager.create("a", 1);
    manager.create("b", 2);
    expect(stage.children).toHaveLength(3);
  });

  it("layers are sorted by zIndex on stage", () => {
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
