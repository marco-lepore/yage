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
    isRenderGroup = false;
    zIndex = 0;
    label = "";
    eventMode = "passive";

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

  it("flips sortableChildren when constructed with a sort fn", () => {
    const container = new MockContainer();
    const layer = new RenderLayer(
      "chars",
      0,
      container as never,
      "world",
      undefined,
      (c) => c.position.y,
    );
    expect(layer.sort).toBeDefined();
    expect(container.sortableChildren).toBe(true);
  });

  describe("setSort", () => {
    it("sets the sort fn and flips sortableChildren on", () => {
      const container = new MockContainer();
      const layer = new RenderLayer("chars", 0, container as never);
      expect(container.sortableChildren).toBe(false);

      const sort = (c: { position: { y: number } }) => c.position.y;
      layer.setSort(sort as never);

      expect(layer.sort).toBe(sort);
      expect(container.sortableChildren).toBe(true);
    });

    it("clears the sort fn and flips sortableChildren off", () => {
      const container = new MockContainer();
      const layer = new RenderLayer(
        "chars",
        0,
        container as never,
        "world",
        undefined,
        (c) => c.position.y,
      );
      expect(container.sortableChildren).toBe(true);

      layer.setSort(undefined);

      expect(layer.sort).toBeUndefined();
      expect(container.sortableChildren).toBe(false);
    });
  });
});

describe("RenderLayerManager", () => {
  let root: InstanceType<typeof MockContainer>;
  let manager: RenderLayerManager;

  beforeEach(() => {
    root = new MockContainer();
    manager = new RenderLayerManager(root as never);
  });

  it("creates a default layer at order 0", () => {
    const def = manager.defaultLayer;
    expect(def.name).toBe("default");
    expect(def.order).toBe(0);
  });

  it("applies defaultLayerOptions to the auto-created default layer", () => {
    const sort = (c: { position: { y: number } }) => c.position.y;
    const mgr = new RenderLayerManager(root as never, undefined, undefined, {
      sort: sort as never,
      isRenderGroup: true,
    });
    const def = mgr.defaultLayer;
    expect(def.sort).toBe(sort);
    expect(
      (def.container as unknown as InstanceType<typeof MockContainer>)
        .sortableChildren,
    ).toBe(true);
    expect(
      (def.container as unknown as InstanceType<typeof MockContainer>)
        .isRenderGroup,
    ).toBe(true);
  });

  it("default layer can be opted into a sort at runtime via setSort", () => {
    const def = manager.defaultLayer;
    expect(def.sort).toBeUndefined();
    const sort = (c: { position: { y: number } }) => c.position.y;
    def.setSort(sort as never);
    expect(def.sort).toBe(sort);
    expect(
      (def.container as unknown as InstanceType<typeof MockContainer>)
        .sortableChildren,
    ).toBe(true);
  });

  it("default layer container is added to root", () => {
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBe(manager.defaultLayer.container);
  });

  it("creates named layers", () => {
    const ui = manager.create("ui", 100);
    expect(ui.name).toBe("ui");
    expect(ui.order).toBe(100);
    expect(root.children).toContain(ui.container);
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
    });
    expect(layer.name).toBe("hud");
    expect(layer.order).toBe(100);
  });

  it("createFromDef with `sort` flips sortableChildren on the container", () => {
    const layer = manager.createFromDef({
      name: "characters",
      order: 0,
      sort: (c) => c.position.y,
    });
    expect(layer.container.sortableChildren).toBe(true);
    expect(layer.sort).toBeDefined();
  });

  it("layers propagate order to container zIndex", () => {
    manager.create("fg", 10);
    manager.create("bg", -5);
    const bgLayer = manager.get("bg");
    const defLayer = manager.defaultLayer;
    const fgLayer = manager.get("fg");
    expect(
      (bgLayer.container as unknown as InstanceType<typeof MockContainer>)
        .zIndex,
    ).toBe(-5);
    expect(
      (defLayer.container as unknown as InstanceType<typeof MockContainer>)
        .zIndex,
    ).toBe(0);
    expect(
      (fgLayer.container as unknown as InstanceType<typeof MockContainer>)
        .zIndex,
    ).toBe(10);
  });

  it("applies default eventMode to created layers", () => {
    const mgr = new RenderLayerManager(root as never, "passive");
    const layer = mgr.create("fg", 10);
    expect(
      (layer.container as unknown as InstanceType<typeof MockContainer>)
        .eventMode,
    ).toBe("passive");
  });

  it("per-layer eventMode overrides default", () => {
    const mgr = new RenderLayerManager(root as never, "passive");
    const layer = mgr.create("ui", 100, { eventMode: "static" as never });
    expect(
      (layer.container as unknown as InstanceType<typeof MockContainer>)
        .eventMode,
    ).toBe("static");
  });

  describe("isRenderGroup", () => {
    it("defaults to false on a freshly created layer", () => {
      const layer = manager.create("plain", 10);
      expect(
        (layer.container as unknown as InstanceType<typeof MockContainer>)
          .isRenderGroup,
      ).toBe(false);
    });

    it("promotes the container when create() opts in", () => {
      const layer = manager.create("isolated", 10, { isRenderGroup: true });
      expect(
        (layer.container as unknown as InstanceType<typeof MockContainer>)
          .isRenderGroup,
      ).toBe(true);
    });

    it("createFromDef forwards isRenderGroup from the LayerDef", () => {
      const layer = manager.createFromDef({
        name: "canopy",
        order: 200,
        isRenderGroup: true,
      });
      expect(
        (layer.container as unknown as InstanceType<typeof MockContainer>)
          .isRenderGroup,
      ).toBe(true);
    });

    it("LayerDef.isRenderGroup overrides the runtime opts default", () => {
      // Opts say `false`; the def's explicit `true` wins because plugin-side
      // overrides shouldn't downgrade a scene's authoritative declaration.
      const layer = manager.createFromDef(
        { name: "filtered", order: 10, isRenderGroup: true },
        { isRenderGroup: false },
      );
      expect(
        (layer.container as unknown as InstanceType<typeof MockContainer>)
          .isRenderGroup,
      ).toBe(true);
    });
  });
});
