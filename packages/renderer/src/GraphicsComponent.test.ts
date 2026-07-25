import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    tint = 0xffffff;
    eventMode = "passive";
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;

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

  class MockGraphics extends MockContainer {
    _drawCalls: string[] = [];

    clear(): MockGraphics {
      this._drawCalls = [];
      return this;
    }

    rect(): MockGraphics {
      this._drawCalls.push("rect");
      return this;
    }

    circle(): MockGraphics {
      this._drawCalls.push("circle");
      return this;
    }

    fill(): MockGraphics {
      this._drawCalls.push("fill");
      return this;
    }

    stroke(): MockGraphics {
      this._drawCalls.push("stroke");
      return this;
    }
  }

  return { mocks: { MockContainer, MockGraphics, MockPoint } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Point: mocks.MockPoint,
}));

import { Transform } from "@yagejs/core";
import { GraphicsComponent } from "./GraphicsComponent.js";
import { createRendererTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("GraphicsComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a graphics object", () => {
    const comp = new GraphicsComponent();
    expect(comp.graphics).toBeDefined();
  });

  it("defaults to 'default' layer", () => {
    const comp = new GraphicsComponent();
    expect(comp.layerName).toBe("default");
  });

  it("accepts custom layer name", () => {
    const comp = new GraphicsComponent({ layer: "fx" });
    expect(comp.layerName).toBe("fx");
  });

  it("draw() calls function with graphics and returns this", () => {
    const comp = new GraphicsComponent();
    const result = comp.draw((g) => {
      (g as unknown as InstanceType<typeof mocks.MockGraphics>).circle();
    });
    expect(result).toBe(comp);
    expect((comp.graphics as unknown as InstanceType<typeof mocks.MockGraphics>)._drawCalls).toContain("circle");
  });

  it("onAdd adds graphics to correct layer container", () => {
    const { scene, layerManager } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new GraphicsComponent());

    const layerContainer = layerManager.defaultLayer.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.graphics);
  });

  it("onDestroy removes graphics from parent and destroys it", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const comp = entity.add(new GraphicsComponent());

    const gfx = comp.graphics as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(gfx.parent).not.toBeNull();

    comp.onDestroy?.();
    expect(gfx.parent).toBeNull();
    expect(gfx.destroyed).toBe(true);
  });

  it("applies visible, tint, and alpha options", () => {
    const comp = new GraphicsComponent({
      visible: false,
      tint: 0x00ff00,
      alpha: 0.25,
    });
    expect(comp.graphics.visible).toBe(false);
    expect(comp.graphics.tint).toBe(0x00ff00);
    expect(comp.graphics.alpha).toBe(0.25);
  });

  it("visible, tint, and alpha setters update the underlying Graphics", () => {
    const comp = new GraphicsComponent();
    comp.visible = false;
    comp.tint = 0xabcdef;
    comp.alpha = 0.5;
    expect(comp.graphics.visible).toBe(false);
    expect(comp.graphics.tint).toBe(0xabcdef);
    expect(comp.graphics.alpha).toBe(0.5);
    expect(comp.visible).toBe(false);
    expect(comp.tint).toBe(0xabcdef);
    expect(comp.alpha).toBe(0.5);
  });

  it("applies the interactive option, defaulting eventMode to static", () => {
    const comp = new GraphicsComponent({ interactive: {} });
    expect(comp.graphics.eventMode).toBe("static");
  });

  describe("serialization", () => {
    it("serialize/fromSnapshot round-trips layer, tint, alpha, visible, interactive", () => {
      const original = new GraphicsComponent({
        layer: "fx",
        tint: 0x123456,
        alpha: 0.7,
        visible: false,
        interactive: { consumeOnInteraction: true },
      });
      const data = original.serialize();
      expect(data).toEqual({
        layer: "fx",
        tint: 0x123456,
        alpha: 0.7,
        visible: false,
        interactive: { consumeOnInteraction: true },
      });

      const restored = GraphicsComponent.fromSnapshot(data);
      expect(restored.layerName).toBe("fx");
      expect(restored.graphics.tint).toBe(0x123456);
      expect(restored.graphics.alpha).toBe(0.7);
      expect(restored.graphics.visible).toBe(false);
      expect(restored.serialize()).toEqual(data);
    });
  });

  describe("inspectRender", () => {
    it("reports world-space bounds of the drawn geometry", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const comp = entity.add(new GraphicsComponent());
      const gfx = comp.graphics as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      gfx.boundsBox = { x: 0, y: 0, width: 40, height: 25 };

      const facet = comp.inspectRender();
      expect(facet.bounds).toEqual({ x: 0, y: 0, width: 40, height: 25 });
      expect(facet.visible).toBe(true);
    });

    it("reports null bounds for an empty Graphics", () => {
      const comp = new GraphicsComponent();
      expect(comp.inspectRender().bounds).toBeNull();
    });
  });
});

describe("GraphicsComponent activeness", () => {
  it("hides the display object while the entity is dormant and restores after", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const gfx = entity.add(new GraphicsComponent());
    expect(gfx.graphics.visible).toBe(true);

    entity.setActive(false);
    expect(gfx.graphics.visible).toBe(false);
    // The game's own value is untouched, so it reads back unchanged.
    expect(gfx.visible).toBe(true);

    entity.setActive(true);
    expect(gfx.graphics.visible).toBe(true);
  });

  it("keeps a hand-hidden component hidden across an activeness cycle", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const gfx = entity.add(new GraphicsComponent());
    gfx.visible = false;

    entity.setActive(false);
    entity.setActive(true);
    expect(gfx.visible).toBe(false);
    expect(gfx.graphics.visible).toBe(false);
  });

  it("stays hidden when added to an already-dormant entity", () => {
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    entity.setActive(false);
    const gfx = entity.add(new GraphicsComponent());
    expect(gfx.graphics.visible).toBe(false);

    entity.setActive(true);
    expect(gfx.graphics.visible).toBe(true);
  });

  it("drops out of the DisplaySystem query while dormant", () => {
    const { scene, queryCache } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    entity.add(new GraphicsComponent());
    const query = queryCache.register([Transform, GraphicsComponent]);
    expect(query.size).toBe(1);

    entity.setActive(false);
    expect(query.size).toBe(0);
  });
});
