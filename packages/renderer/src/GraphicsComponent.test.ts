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

  return { mocks: { MockContainer, MockGraphics } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
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
});
