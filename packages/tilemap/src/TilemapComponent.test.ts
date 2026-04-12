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
          (c as MockContainer).destroy();
        }
      }
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  const mockAssetsGet = vi.fn();

  return { mocks: { MockContainer, mockAssetsGet } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Assets: { get: mocks.mockAssetsGet },
  Texture: vi.fn(),
  Rectangle: vi.fn(),
}));

vi.mock("@pixi/tilemap", () => ({
  CompositeTilemap: mocks.MockContainer,
}));

// Mock parseTiledMap to avoid complex PixiJS texture resolution
vi.mock("./tiled/parseTiledMap.js", () => ({
  createTilemapLayers: vi.fn(() => [
    new mocks.MockContainer(),
    new mocks.MockContainer(),
  ]),
  toTilemapData: vi.fn((map: Record<string, unknown>) => ({
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    tileLayers: [
      {
        name: "ground",
        data: Array(80).fill(1) as number[],
        width: 10,
        height: 8,
        visible: true,
      },
    ],
    objectLayers: [
      {
        name: "collisions",
        objects: [
          { id: 1, name: "wall", x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true },
        ],
        visible: true,
      },
    ],
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
import { CameraKey, RenderLayerManagerKey, StageKey } from "@yagejs/renderer";
import { Camera, RenderLayerManager } from "@yagejs/renderer";
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

  return { ctx, scene, layerManager, stage };
}

const testMap: TiledMapData = {
  width: 10,
  height: 8,
  tilewidth: 16,
  tileheight: 16,
  layers: [
    {
      type: "tilelayer",
      data: Array(80).fill(1) as number[],
      width: 10,
      height: 8,
      id: 1,
      name: "ground",
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
    },
    {
      type: "objectgroup",
      id: 2,
      name: "collisions",
      objects: [
        { id: 1, name: "wall", x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true },
      ],
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
    },
  ],
  tilesets: [
    {
      firstgid: 1,
      data: {
        name: "dungeon",
        tilewidth: 16,
        tileheight: 16,
        tilecount: 1,
        columns: 1,
        tiles: [{ id: 0, image: "tiles/tile0.png" }],
      },
    },
  ],
};

describe("TilemapComponent", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("exposes map dimension getters", () => {
    const comp = new TilemapComponent({ map: testMap });
    expect(comp.widthPx).toBe(160);
    expect(comp.heightPx).toBe(128);
    expect(comp.tileWidth).toBe(16);
    expect(comp.tileHeight).toBe(16);
  });

  it("onAdd creates container with tilemap layers and adds to render layer", () => {
    const { scene, layerManager } = createTestContext();
    const entity = scene.spawn("tilemap");
    entity.add(new Transform());
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    const layerContainer = layerManager.defaultLayer.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.container);
    // createTilemapLayers mock returns 2 children
    expect((comp.container as unknown as InstanceType<typeof mocks.MockContainer>).children).toHaveLength(2);
  });

  it("onDestroy removes container from parent and destroys it", () => {
    const { scene } = createTestContext();
    const entity = scene.spawn("tilemap");
    entity.add(new Transform());
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    const container = comp.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.parent).not.toBeNull();

    comp.onDestroy?.();
    expect(container.parent).toBeNull();
    expect(container.destroyed).toBe(true);
  });

  it("getTileAt returns correct GID for valid position", () => {
    const { scene } = createTestContext();
    const entity = scene.spawn("tilemap");
    entity.add(new Transform());
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    // Tile at (0,0) should be GID 1 (all tiles are 1)
    expect(comp.getTileAt(0, 0)).toBe(1);
    expect(comp.getTileAt(8, 8)).toBe(1);
  });

  it("getTileAt returns null for out-of-bounds position", () => {
    const { scene } = createTestContext();
    const entity = scene.spawn("tilemap");
    entity.add(new Transform());
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    expect(comp.getTileAt(-1, 0)).toBeNull();
    expect(comp.getTileAt(0, -1)).toBeNull();
    expect(comp.getTileAt(200, 0)).toBeNull();
    expect(comp.getTileAt(0, 200)).toBeNull();
  });

  it("getTileAt accounts for entity Transform offset", () => {
    const { scene } = createTestContext();
    const entity = scene.spawn("tilemap");
    entity.add(new Transform({ position: new Vec2(100, 100) }));
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    // Without offset: (0,0) is in the map. With offset: need world pos 100,100 for tile (0,0)
    expect(comp.getTileAt(100, 100)).toBe(1);
    // World pos (0,0) maps to local (-100,-100) which is out of bounds
    expect(comp.getTileAt(0, 0)).toBeNull();
  });

  it("getCollisionShapes returns collision shapes", () => {
    const comp = new TilemapComponent({ map: testMap });
    const shapes = comp.getCollisionShapes();
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.type).toBe("rect");
  });

  it("getObjects returns grouped objects", () => {
    const comp = new TilemapComponent({ map: testMap });
    const objects = comp.getObjects();
    expect(objects["wall"]).toBeDefined();
  });

  describe("serialization", () => {
    it("construction with mapKey resolves from Assets.get", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const comp = new TilemapComponent({ mapKey: "dungeon.json" });
      expect(comp.widthPx).toBe(160);
      expect(comp.heightPx).toBe(128);
      mocks.mockAssetsGet.mockReset();
    });

    it("throws when mapKey asset is not loaded", () => {
      mocks.mockAssetsGet.mockReturnValue(undefined);
      expect(() => new TilemapComponent({ mapKey: "missing.json" })).toThrow(
        /not loaded/,
      );
      mocks.mockAssetsGet.mockReset();
    });

    it("throws when neither map nor mapKey provided", () => {
      expect(() => new TilemapComponent({} as never)).toThrow(
        /requires either/,
      );
    });

    it("serialize returns null with warning when using raw map", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const comp = new TilemapComponent({ map: testMap });
      expect(comp.serialize()).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("serialize returns mapKey + layer when using mapKey", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const comp = new TilemapComponent({
        mapKey: "dungeon.json",
        layers: ["ground"],
        layer: "bg",
      });
      expect(comp.serialize()).toEqual({
        mapKey: "dungeon.json",
        layers: ["ground"],
        layer: "bg",
      });
      mocks.mockAssetsGet.mockReset();
    });

    it("fromSnapshot round-trips", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const original = new TilemapComponent({ mapKey: "dungeon.json", layer: "bg" });
      const data = original.serialize()!;
      const restored = TilemapComponent.fromSnapshot(data);
      expect(restored.serialize()).toEqual(data);
      mocks.mockAssetsGet.mockReset();
    });
  });
});
