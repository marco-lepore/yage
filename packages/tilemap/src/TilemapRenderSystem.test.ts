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

  return { mocks: { MockContainer } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Assets: { get: vi.fn() },
  Texture: vi.fn(),
  Rectangle: vi.fn(),
}));

vi.mock("@pixi/tilemap", () => ({
  CompositeTilemap: mocks.MockContainer,
}));

vi.mock("./tiled/parseTiledMap.js", () => ({
  createTilemapLayers: vi.fn(() => [new mocks.MockContainer()]),
  toTilemapData: vi.fn((map: Record<string, unknown>) => ({
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    tileLayers: [],
    objectLayers: [],
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
  Phase,
  _resetEntityIdCounter,
} from "@yage/core";
import type { EngineEvents } from "@yage/core";
import { CameraKey, RenderLayerManagerKey, StageKey } from "@yage/renderer";
import { Camera, RenderLayerManager } from "@yage/renderer";
import { TilemapComponent } from "./TilemapComponent.js";
import { TilemapRenderSystem } from "./TilemapRenderSystem.js";
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
  const boundary = new ErrorBoundary(logger);
  const gameLoop = new GameLoop();
  const scheduler = new SystemScheduler();
  scheduler.setErrorBoundary(boundary);

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);

  const stage = new mocks.MockContainer();
  const camera = new Camera(800, 600);
  const layerManager = new RenderLayerManager(stage as never);

  ctx.register(StageKey, stage as never);
  ctx.register(CameraKey, camera);
  ctx.register(RenderLayerManagerKey, layerManager);

  const scene = new TestScene();
  scene._setContext(ctx);

  return { ctx, scene, queryCache, stage };
}

const testMap: TiledMapData = {
  width: 10,
  height: 8,
  tilewidth: 16,
  tileheight: 16,
  layers: [],
  tilesets: [],
};

describe("TilemapRenderSystem", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("has Render phase and priority -1", () => {
    const system = new TilemapRenderSystem();
    expect(system.phase).toBe(Phase.Render);
    expect(system.priority).toBe(-1);
  });

  it("syncs Transform to tilemap container position", () => {
    const { ctx, scene } = createTestContext();
    const system = new TilemapRenderSystem();
    system._setContext(ctx);
    system.onRegister!(ctx);

    const entity = scene.spawn("tilemap");
    entity.add(new Transform({
      position: new Vec2(50, 100),
      rotation: 0.5,
      scale: new Vec2(2, 3),
    }));
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    system.update(16);

    const container = comp.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.position.x).toBe(50);
    expect(container.position.y).toBe(100);
    expect(container.rotation).toBe(0.5);
    expect(container.scale.x).toBe(2);
    expect(container.scale.y).toBe(3);
  });

  it("skips disabled components", () => {
    const { ctx, scene } = createTestContext();
    const system = new TilemapRenderSystem();
    system._setContext(ctx);
    system.onRegister!(ctx);

    const entity = scene.spawn("tilemap");
    entity.add(new Transform({ position: new Vec2(50, 0) }));
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    comp.enabled = false;

    system.update(16);

    const container = comp.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.position.x).toBe(0); // Not synced
  });
});
