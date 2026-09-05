import { describe, it, expect, vi, beforeEach } from "vitest";

const { MockContainer } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    filters: unknown = null;
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

import { Scene } from "@yagejs/core";
import type { LayerDef } from "./LayerDef.js";
import { SceneRenderTreeProviderImpl } from "./SceneRenderTreeProvider.js";

function makeFakeScene(name: string, layers?: LayerDef[]): Scene {
  return { name, layers } as unknown as Scene;
}

describe("ensureLayer order", () => {
  it("creates missing layers, preserves host order, and warns once per expected order", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new SceneRenderTreeProviderImpl(
      new MockContainer() as never,
    );
    const tree = provider.createForScene(
      makeFakeScene("test", [{ name: "host", order: 9 }]),
    );
    const created = tree.ensureLayer({
      name: "new",
      order: 10,
      space: "screen",
    });
    expect(tree.ensureLayer({ name: "new", order: 10 })).toBe(created);
    expect(warn).not.toHaveBeenCalled();
    const host = tree.ensureLayer({ name: "host", order: 20 });
    expect(host.order).toBe(9);
    expect(tree.ensureLayer({ name: "host", order: 20 })).toBe(host);
    expect(warn).toHaveBeenCalledTimes(1);
    tree.ensureLayer({ name: "host", order: 30 });
    expect(warn).toHaveBeenCalledTimes(2);
    provider.destroyAll();
    warn.mockRestore();
  });
});

function makeScene(name: string, transparentBelow = false): Scene {
  // `readonly transparentBelow` is a compile-time guard for game code, not
  // a runtime invariant; tests reach past it to spin up scenes with every
  // flag combination without boilerplate subclasses.
  class TestScene extends Scene {
    readonly name = name;
  }
  const scene = new TestScene();
  (scene as { transparentBelow: boolean }).transparentBelow = transparentBelow;
  return scene;
}

function visibleOf(
  provider: SceneRenderTreeProviderImpl,
  scene: Scene,
): boolean {
  const tree = provider.getTree(scene);
  if (!tree) throw new Error(`no tree for ${scene.name}`);
  return (tree.root as unknown as InstanceType<typeof MockContainer>).visible;
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
    provider.createForScene(
      makeFakeScene("scene", [{ name: "ui", order: 1000 }]),
    );

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
      makeFakeScene("scene", [{ name: "ui", order: 1000, space: "screen" }]),
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
      makeFakeScene("scene", [
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

describe("SceneRenderTreeProvider — default layer configuration", () => {
  it("applies a declared { name: 'default', sort } to the pre-created layer", () => {
    const provider = new SceneRenderTreeProviderImpl(
      new MockContainer() as never,
    );
    const sort = (c: { position: { y: number } }) => c.position.y;
    const tree = provider.createForScene(
      // A non-zero `order` is declared to prove it's ignored — "default" is
      // pinned to order 0 — while `space` / `isRenderGroup` pass through.
      makeFakeScene("scene", [
        {
          name: "default",
          order: 999,
          sort: sort as never,
          space: "screen",
          isRenderGroup: true,
        },
      ]),
    );

    const def = tree.defaultLayer;
    expect(def.sort).toBe(sort);
    expect(def.order).toBe(0);
    expect(def.space).toBe("screen");
    expect(
      (def.container as unknown as InstanceType<typeof MockContainer>)
        .sortableChildren,
    ).toBe(true);
    expect(
      (def.container as unknown as InstanceType<typeof MockContainer>)
        .isRenderGroup,
    ).toBe(true);
  });

  it("does not create a duplicate layer when 'default' is declared", () => {
    const provider = new SceneRenderTreeProviderImpl(
      new MockContainer() as never,
    );
    const tree = provider.createForScene(
      makeFakeScene("scene", [{ name: "default", order: 0 }]),
    );
    expect(tree.getAll().filter((l) => l.name === "default")).toHaveLength(1);
  });
});

describe("SceneRenderTreeProviderImpl", () => {
  let root: InstanceType<typeof MockContainer>;
  let provider: SceneRenderTreeProviderImpl;

  beforeEach(() => {
    root = new MockContainer();
    provider = new SceneRenderTreeProviderImpl(root as never);
  });

  describe("applyTransparentBelow", () => {
    it("leaves the topmost scene visible regardless of flag", () => {
      const a = makeScene("a", false);
      provider.createForScene(a);

      provider.applyTransparentBelow([a]);

      expect(visibleOf(provider, a)).toBe(true);
    });

    it("hides below scenes when the top scene has transparentBelow=false", () => {
      const below = makeScene("below");
      const top = makeScene("top", false);
      provider.createForScene(below);
      provider.createForScene(top);

      provider.applyTransparentBelow([below, top]);

      expect(visibleOf(provider, below)).toBe(false);
      expect(visibleOf(provider, top)).toBe(true);
    });

    it("keeps below scenes visible when the top scene is transparentBelow=true", () => {
      const below = makeScene("below");
      const top = makeScene("top", true);
      provider.createForScene(below);
      provider.createForScene(top);

      provider.applyTransparentBelow([below, top]);

      expect(visibleOf(provider, below)).toBe(true);
    });

    it("propagates the chain bottom-out — one opaque scene hides everything below", () => {
      const a = makeScene("a"); // bottom, default false
      const b = makeScene("b", false); // opaque
      const c = makeScene("c", true); // overlay
      const d = makeScene("d", true); // overlay, top
      provider.createForScene(a);
      provider.createForScene(b);
      provider.createForScene(c);
      provider.createForScene(d);

      provider.applyTransparentBelow([a, b, c, d]);

      // Walking top-down: d visible, c visible (d=true), b visible (c=true),
      // a HIDDEN (b=false).
      expect(visibleOf(provider, d)).toBe(true);
      expect(visibleOf(provider, c)).toBe(true);
      expect(visibleOf(provider, b)).toBe(true);
      expect(visibleOf(provider, a)).toBe(false);
    });

    it("re-shows a previously hidden below scene when the opaque cover is removed", () => {
      const below = makeScene("below");
      const top = makeScene("top", false);
      provider.createForScene(below);
      provider.createForScene(top);

      provider.applyTransparentBelow([below, top]);
      expect(visibleOf(provider, below)).toBe(false);

      provider.applyTransparentBelow([below]);
      expect(visibleOf(provider, below)).toBe(true);
    });

    it("leaves detached scene trees (not in stack) untouched", () => {
      const stacked = makeScene("stacked");
      const detached = makeScene("detached");
      provider.createForScene(stacked);
      provider.createForScene(detached);

      const detachedTree = provider.getTree(detached)!;
      (
        detachedTree.root as unknown as InstanceType<typeof MockContainer>
      ).visible = true;

      provider.applyTransparentBelow([stacked]);

      expect(
        (detachedTree.root as unknown as InstanceType<typeof MockContainer>)
          .visible,
      ).toBe(true);
    });
  });

  describe("resetVisibility", () => {
    it("re-shows every in-stack scene tree", () => {
      const a = makeScene("a");
      const b = makeScene("b", false);
      provider.createForScene(a);
      provider.createForScene(b);

      provider.applyTransparentBelow([a, b]);
      expect(visibleOf(provider, a)).toBe(false);

      provider.resetVisibility([a, b]);
      expect(visibleOf(provider, a)).toBe(true);
    });

    it("leaves detached scene trees (not in stack) untouched", () => {
      const stacked = makeScene("stacked");
      const detached = makeScene("detached");
      provider.createForScene(stacked);
      provider.createForScene(detached);

      // Mirror the contract on `applyTransparentBelow`: a detached scene's
      // root visibility is owned by whoever mounted it, so a transition
      // start mustn't silently re-show a deliberately hidden detached root.
      const detachedTree = provider.getTree(detached)!;
      (
        detachedTree.root as unknown as InstanceType<typeof MockContainer>
      ).visible = false;

      provider.resetVisibility([stacked]);

      expect(
        (detachedTree.root as unknown as InstanceType<typeof MockContainer>)
          .visible,
      ).toBe(false);
    });
  });
});
