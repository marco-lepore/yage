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

    removeFromParent(): MockContainer {
      this.parent?.removeChild(this);
      return this;
    }

    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }

    destroy(): void {}
  }
  return { MockContainer };
});

vi.mock("pixi.js", () => ({
  Container: MockContainer,
}));

import { SceneRenderTreeProviderImpl } from "./SceneRenderTreeProvider.js";
import type { LayerDef } from "./LayerDef.js";
import type { Scene } from "@yagejs/core";

function makeScene(name: string, layers?: LayerDef[]): Scene {
  return { name, layers } as unknown as Scene;
}

describe("SceneRenderTreeProvider — 'ui' layer name-shadow warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns when a layer named 'ui' is declared without an explicit space", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new SceneRenderTreeProviderImpl(
      new MockContainer() as never,
    );
    provider.createForScene(makeScene("scene", [{ name: "ui", order: 1000 }]));

    const matching = warn.mock.calls.filter((args) =>
      String(args[0]).includes("Layer 'ui' is the canonical UI layer name"),
    );
    expect(matching.length).toBe(1);
    warn.mockRestore();
  });

  it("does not warn when 'ui' is declared with space: 'screen'", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new SceneRenderTreeProviderImpl(
      new MockContainer() as never,
    );
    provider.createForScene(
      makeScene("scene", [{ name: "ui", order: 1000, space: "screen" }]),
    );

    const matching = warn.mock.calls.filter((args) =>
      String(args[0]).includes("Layer 'ui' is the canonical UI layer name"),
    );
    expect(matching.length).toBe(0);
    warn.mockRestore();
  });

  it("does not warn for layers with other names", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new SceneRenderTreeProviderImpl(
      new MockContainer() as never,
    );
    provider.createForScene(
      makeScene("scene", [
        { name: "background", order: -10 },
        { name: "world", order: 0 },
        { name: "hud", order: 100 },
      ]),
    );

    const matching = warn.mock.calls.filter((args) =>
      String(args[0]).includes("Layer 'ui' is the canonical UI layer name"),
    );
    expect(matching.length).toBe(0);
    warn.mockRestore();
  });
});
