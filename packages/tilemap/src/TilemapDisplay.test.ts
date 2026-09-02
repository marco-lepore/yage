import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockPoint {
    x: number;
    y: number;

    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }

    set(x: number, y = x): void {
      this.x = x;
      this.y = y;
    }
  }

  class MockContainer {
    children: MockContainer[] = [];
    position = new MockPoint(0, 0);
    scale = new MockPoint(1, 1);
    rotation = 0;
    visible = true;
    alpha = 1;
    tint = 0xffffff;
    blendMode = "inherit";
    filters: unknown[] | null = null;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
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

    removeFromParent(): void {
      this.parent?.removeChild(this);
    }

    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }

    destroy(opts?: { children?: boolean }): void {
      if (opts?.children) {
        for (const c of this.children) {
          c.destroy();
        }
      }
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockColorMatrixFilter {
    matrix: number[] = [];

    destroy(): void {}
  }

  return { mocks: { MockContainer, MockColorMatrixFilter } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  ColorMatrixFilter: mocks.MockColorMatrixFilter,
  Assets: { get: vi.fn() },
  Texture: vi.fn(),
  Rectangle: vi.fn(),
}));

vi.mock("@pixi/tilemap", () => ({
  CompositeTilemap: mocks.MockContainer,
}));

vi.mock("./tiled/parseTiledMap.js", () => ({
  _tilemapLayerHasAnimation: vi.fn(() => false),
  createTilemapLayers: vi.fn(() => [new mocks.MockContainer()]),
  toTilemapData: vi.fn((map: Record<string, unknown>) => ({
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    tileLayers: [],
    objectLayers: [],
    tilesets: [],
    diagnostics: [],
  })),
}));

import {
  EngineContext,
  QueryCache,
  QueryCacheKey,
  EventBus,
  EventBusKey,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  GameLoop,
  GameLoopKey,
  SystemScheduler,
  SystemSchedulerKey,
  Scene,
  Transform,
  Vec2,
  _resetEntityIdCounter,
} from "@yagejs/core";
import type { EngineEvents } from "@yagejs/core";
import {
  DisplaySystem,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
  ySort,
} from "@yagejs/renderer";
import { RenderLayerManager } from "@yagejs/renderer";
import type { SceneRenderTree } from "@yagejs/renderer";
import { TilemapComponent } from "./TilemapComponent.js";
import type { TiledMapData } from "./tiled/types.js";

class TestScene extends Scene {
  readonly name = "test-scene";
}

function createTestContext() {
  _resetEntityIdCounter();

  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const gameLoop = new GameLoop();
  const boundary = new ErrorBoundary(logger);
  const scheduler = new SystemScheduler();
  scheduler.setErrorBoundary(boundary);

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);

  const root = new mocks.MockContainer();
  const layerManager = new RenderLayerManager(root as never);
  const tree: SceneRenderTree = {
    root: root as never,
    get: (n) => layerManager.get(n),
    tryGet: (n) => layerManager.tryGet(n),
    getAll: () => layerManager.getAll(),
    get defaultLayer() {
      return layerManager.defaultLayer;
    },
    ensureLayer: (def, opts) =>
      layerManager.tryGet(def.name) ?? layerManager.createFromDef(def, opts),
    fx: {
      addEffect: () => {
        throw new Error("Tilemap test tree does not support fx.addEffect.");
      },
      findEffect: () => null,
    } as never,
    setMask: () => {
      throw new Error("Tilemap test tree does not support setMask.");
    },
    clearMask: () => undefined,
  };

  const scene = new TestScene();
  ctx.register(SceneRenderTreeProviderKey, {
    createForScene: () => tree,
    destroyForScene: () => undefined,
    getTree: () => tree,
    allTrees: function* () {
      yield [scene, tree];
    },
  });
  scene._setContext(ctx);
  scene._registerScoped(SceneRenderTreeKey, tree);

  return { ctx, scene, queryCache, root, tree };
}

const testMap: TiledMapData = {
  width: 10,
  height: 8,
  tilewidth: 16,
  tileheight: 16,
  layers: [],
  tilesets: [],
};

describe("tilemap rendering through DisplaySystem", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  function createSystem(ctx: EngineContext): DisplaySystem {
    const system = new DisplaySystem();
    system._setContext(ctx);
    system.onRegister(ctx);
    return system;
  }

  it("syncs Transform to tilemap container position", () => {
    const { ctx, scene } = createTestContext();
    const system = createSystem(ctx);

    const entity = scene.spawn("tilemap");
    entity.add(
      new Transform({
        position: new Vec2(50, 100),
        rotation: 0.5,
        scale: new Vec2(2, 3),
      }),
    );
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    system.update();

    const container = comp.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(container.position.x).toBe(50);
    expect(container.position.y).toBe(100);
    expect(container.rotation).toBe(0.5);
    expect(container.scale.x).toBe(2);
    expect(container.scale.y).toBe(3);
  });

  it("combines visual modifiers without changing Transform", () => {
    const { ctx, scene } = createTestContext();
    const system = createSystem(ctx);

    const entity = scene.spawn("tilemap");
    const transform = entity.add(
      new Transform({
        position: new Vec2(50, 100),
        rotation: 0.5,
        scale: new Vec2(2, 3),
      }),
    );
    const comp = entity.add(new TilemapComponent({ map: testMap }));
    const modifier = comp.modifiers.addTransform({
      position: new Vec2(4, -6),
      rotation: 0.25,
      scale: new Vec2(0.5, 2),
    });

    system.update();

    const container = comp.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(container.position.x).toBe(54);
    expect(container.position.y).toBe(94);
    expect(container.rotation).toBe(0.75);
    expect(container.scale.x).toBe(1);
    expect(container.scale.y).toBe(6);
    expect(transform.position).toEqual(new Vec2(50, 100));

    modifier.remove();
    system.update();
    expect(container.position.x).toBe(50);
    expect(container.position.y).toBe(100);
    expect(container.rotation).toBe(0.5);
    expect(container.scale.x).toBe(2);
    expect(container.scale.y).toBe(3);
  });

  it("skips disabled components", () => {
    const { ctx, scene } = createTestContext();
    const system = createSystem(ctx);

    const entity = scene.spawn("tilemap");
    entity.add(new Transform({ position: new Vec2(50, 0) }));
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    comp.enabled = false;

    system.update();

    const container = comp.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(container.position.x).toBe(0); // Not synced
  });

  it("keeps the depth key off the unmodified position in a ySort layer", () => {
    const { ctx, scene, tree } = createTestContext();
    tree.ensureLayer({ name: "ground", order: 0, sort: ySort });
    const system = createSystem(ctx);

    const entity = scene.spawn("tilemap");
    entity.add(new Transform({ position: new Vec2(0, 100) }));
    const comp = entity.add(
      new TilemapComponent({ map: testMap, layer: "ground" }),
    );
    comp.modifiers.addTransform({ position: new Vec2(0, 40) });

    system.update();

    const container = comp.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(container.zIndex).toBe(100);
    expect(container.position.y).toBe(140);
  });
});
