/**
 * Scope-level integration tests for the effects system. Exercises the four
 * scopes (component / layer / scene / screen) end-to-end against the mock
 * pixi/test-helpers stack, plus a cross-scope ordering test that verifies
 * each scope's filter ends up on the right Container.
 */
import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    filters: unknown = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    eventMode = "passive";
    destroyed = false;
    addChild(c: MockContainer): MockContainer {
      this.children.push(c);
      c.parent = this;
      return c;
    }
    removeChild(c: MockContainer): MockContainer {
      const i = this.children.indexOf(c);
      if (i !== -1) {
        this.children.splice(i, 1);
        c.parent = null;
      }
      return c;
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

  class MockSprite extends MockContainer {
    texture: unknown = null;
    static from = vi.fn((tex: unknown): MockSprite => {
      const s = new MockSprite();
      s.texture = tex;
      return s;
    });
    anchor = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    tint = 0xffffff;
    alpha = 1;
    visible = true;
  }

  class MockFilter {
    enabled = true;
    constructor(public label = "filter") {}
  }

  return { mocks: { MockContainer, MockSprite, MockFilter } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  Filter: mocks.MockFilter,
  AlphaFilter: class extends mocks.MockFilter {
    alpha: number;
    constructor(opts?: { alpha?: number }) {
      super("alpha");
      this.alpha = opts?.alpha ?? 1;
    }
  },
}));

import { ProcessSystem, ProcessSystemKey, Transform } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { SpriteComponent } from "../SpriteComponent.js";
import { rawFilter } from "./rawFilter.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "../test-helpers.js";

function makeTestFilter(label: string): InstanceType<typeof mocks.MockFilter> {
  return new mocks.MockFilter(label);
}

describe("Phase 1b — broader scopes", () => {
  describe("layer scope", () => {
    it("applies addEffect filter to the layer container", () => {
      const { tree } = createRendererTestContext();
      const layer = tree.defaultLayer;
      const f = makeTestFilter("layer-bloom");
      layer.addEffect(rawFilter(f as never));

      expect(layer.container.filters).toEqual([f]);
    });

    it("strips owned layer filters when the scene exits", () => {
      const { scene, provider } = createRendererTestContext();
      const tree = provider.getTree(scene)!;
      const layer = tree.defaultLayer;
      const layerContainer = layer.container as never as InstanceType<
        typeof mocks.MockContainer
      >;
      const f = makeTestFilter("layer-bloom");
      layer.addEffect(rawFilter(f as never));
      expect(layerContainer.filters).toEqual([f]);

      provider.destroyForScene(scene);
      // After destroy, owned filters are removed (container also destroyed).
      expect(layerContainer.filters).toBeNull();
    });

    it("preserves user-assigned filters on the layer container at destroy", () => {
      const { scene, provider } = createRendererTestContext();
      const tree = provider.getTree(scene)!;
      const layer = tree.defaultLayer;
      const layerContainer = layer.container as never as InstanceType<
        typeof mocks.MockContainer
      >;

      const userFilter = makeTestFilter("user");
      const ownedFilter = makeTestFilter("owned");
      layer.addEffect(rawFilter(ownedFilter as never));
      layerContainer.filters = [userFilter, ownedFilter];

      provider.destroyForScene(scene);
      expect(layerContainer.filters).toEqual([userFilter]);
    });
  });

  describe("scene scope", () => {
    it("applies addEffect filter to the per-scene root container", () => {
      const { tree, root } = createRendererTestContext();
      const f = makeTestFilter("scene-crt");
      tree.addEffect(rawFilter(f as never));
      expect(root.filters).toEqual([f]);
    });

    it("scene-scope effects are torn down on scene exit", () => {
      const { scene, provider, root } = createRendererTestContext();
      const tree = provider.getTree(scene)!;
      const f = makeTestFilter("scene-crt");
      tree.addEffect(rawFilter(f as never));
      expect(root.filters).toEqual([f]);

      provider.destroyForScene(scene);
      expect(root.filters).toBeNull();
    });
  });

  describe("cross-scope ordering", () => {
    it("places filters at component / layer / scene each on their own container", () => {
      const { scene, tree, root, layerManager } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));

      const cFilter = makeTestFilter("component-flash");
      const lFilter = makeTestFilter("layer-bloom");
      const sFilter = makeTestFilter("scene-crt");

      sprite.addEffect(rawFilter(cFilter as never));
      tree.defaultLayer.addEffect(rawFilter(lFilter as never));
      tree.addEffect(rawFilter(sFilter as never));

      const spriteAsContainer = sprite.sprite as never as InstanceType<
        typeof mocks.MockContainer
      >;
      const layerContainer = layerManager.defaultLayer
        .container as never as InstanceType<typeof mocks.MockContainer>;

      expect(spriteAsContainer.filters).toEqual([cFilter]);
      expect(layerContainer.filters).toEqual([lFilter]);
      expect(root.filters).toEqual([sFilter]);
      // No cross-talk: each scope owns its own filter list.
      expect(spriteAsContainer.filters).not.toEqual(layerContainer.filters);
    });

    it("layer-scope fade pauses with the owning scene", () => {
      // Drives the new makeSceneScopedProcessHost path: layer fades route
      // through ProcessSystem.addForScene, so they must respect activeScenes.
      const ctx = createRendererTestContext();
      const ps = ctx.context.resolve(ProcessSystemKey) as ProcessSystem;
      // Plug in a SceneManager-like shim so ProcessSystem.update walks the
      // scene's pool. The renderer test-helpers don't wire SceneManager, so
      // we set it up directly.
      const scene = ctx.scene as Scene & { isPaused?: boolean };
      const sceneManager = {
        activeScenes: [] as Scene[],
        get active() {
          return this.activeScenes[0];
        },
      };
      (ps as unknown as { sceneManager: typeof sceneManager }).sceneManager =
        sceneManager;
      sceneManager.activeScenes = [scene];

      let intensity = 0;
      const f = { enabled: true, label: "layer-bloom" };
      const handle = ctx.tree.defaultLayer.addEffect(
        rawFilter(f as never, {
          intensity: {
            get: () => intensity,
            set: (v) => {
              intensity = v;
            },
          },
        }),
      );
      handle.fadeIn(100);

      ps.update(50); // half-way
      expect(intensity).toBeCloseTo(0.5, 5);

      // Pause the scene → addForScene pool stops ticking.
      sceneManager.activeScenes = [];
      ps.update(100);
      expect(intensity).toBeCloseTo(0.5, 5);

      // Resume the scene → tween resumes from where it left off.
      sceneManager.activeScenes = [scene];
      ps.update(50);
      expect(intensity).toBeCloseTo(1, 5);
    });

    it("entity destroy clears component-scope filters but leaves layer/scene intact", () => {
      const { scene, tree, root, layerManager } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      const sprite = entity.add(new SpriteComponent({ texture: {} as never }));

      const cFilter = makeTestFilter("c");
      const lFilter = makeTestFilter("l");
      const sFilter = makeTestFilter("s");
      sprite.addEffect(rawFilter(cFilter as never));
      tree.defaultLayer.addEffect(rawFilter(lFilter as never));
      tree.addEffect(rawFilter(sFilter as never));

      const layerContainer = layerManager.defaultLayer
        .container as never as InstanceType<typeof mocks.MockContainer>;

      // Simulate entity destroy ordering used in production
      sprite.onDestroy?.();

      expect(layerContainer.filters).toEqual([lFilter]);
      expect(root.filters).toEqual([sFilter]);
    });
  });
});
