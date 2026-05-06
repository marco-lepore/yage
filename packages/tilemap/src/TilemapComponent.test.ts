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

// Stub only the rendering side of parseTiledMap (sub-textures, PixiJS).
// Use the real toTilemapData so tests exercise honest object-layer parsing.
vi.mock("./tiled/parseTiledMap.js", async () => {
  const actual = await vi.importActual<
    typeof import("./tiled/parseTiledMap.js")
  >("./tiled/parseTiledMap.js");
  return {
    ...actual,
    createTilemapLayers: vi.fn(() => [
      new mocks.MockContainer(),
      new mocks.MockContainer(),
    ]),
  };
});

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
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import { RenderLayerManager } from "@yagejs/renderer";
import type { SceneRenderTree } from "@yagejs/renderer";
import { AssetHandle } from "@yagejs/core";
import { TilemapComponent } from "./TilemapComponent.js";
import { tiledObjectKey } from "./keys.js";
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

  return { ctx, scene, layerManager, root };
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
        {
          id: 1,
          name: "wall",
          x: 0,
          y: 0,
          width: 32,
          height: 32,
          rotation: 0,
          visible: true,
        },
      ],
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
    },
    {
      type: "objectgroup",
      id: 3,
      name: "interactables",
      objects: [
        {
          id: 10,
          name: "Player",
          class: "Player",
          point: true,
          x: 8,
          y: 8,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
        },
        {
          id: 11,
          name: "EnemySpawn",
          class: "EnemySpawn",
          point: true,
          x: 64,
          y: 32,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
          properties: [
            { name: "type", type: "string", value: "Bat" },
            { name: "count", type: "int", value: 3 },
          ],
        },
        {
          id: 12,
          name: "EnemySpawn",
          class: "EnemySpawn",
          point: true,
          x: 96,
          y: 96,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
          properties: [
            { name: "type", type: "string", value: "Base" },
            { name: "count", type: "int", value: 1 },
          ],
        },
        {
          id: 13,
          name: "Controller",
          class: "EnemySpawnController",
          point: true,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
          properties: [
            { name: "spawns[0]", type: "object", value: 11 },
            { name: "spawns[1]", type: "object", value: 12 },
          ],
        },
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

    const layerContainer = layerManager.defaultLayer
      .container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(layerContainer.children).toContain(comp.container);
    // createTilemapLayers mock returns 2 children
    expect(
      (comp.container as unknown as InstanceType<typeof mocks.MockContainer>)
        .children,
    ).toHaveLength(2);
  });

  it("onDestroy removes container from parent and destroys it", () => {
    const { scene } = createTestContext();
    const entity = scene.spawn("tilemap");
    entity.add(new Transform());
    const comp = entity.add(new TilemapComponent({ map: testMap }));

    const container = comp.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
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

    it("throws when neither source, map, nor mapKey provided", () => {
      expect(() => new TilemapComponent({} as never)).toThrow(
        /requires one of/,
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
      const original = new TilemapComponent({
        mapKey: "dungeon.json",
        layer: "bg",
      });
      const data = original.serialize()!;
      const restored = TilemapComponent.fromSnapshot(data);
      expect(restored.serialize()).toEqual(data);
      mocks.mockAssetsGet.mockReset();
    });

    it("source-handle construction captures the asset path as mapKey", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const handle = new AssetHandle<TiledMapData>(
        "tiledMap",
        "/assets/dungeon.json",
      );
      const comp = new TilemapComponent({ source: handle });
      expect(comp.mapKey).toBe("/assets/dungeon.json");
      expect(comp.serialize()).toEqual({
        mapKey: "/assets/dungeon.json",
        layer: "default",
      });
      mocks.mockAssetsGet.mockReset();
    });

    it("explicit keyPrefix round-trips through serialize", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const comp = new TilemapComponent({
        mapKey: "dungeon.json",
        keyPrefix: "level1",
      });
      expect(comp.keyPrefix).toBe("level1");
      const data = comp.serialize()!;
      expect(data.keyPrefix).toBe("level1");
      const restored = TilemapComponent.fromSnapshot(data);
      expect(restored.keyPrefix).toBe("level1");
      mocks.mockAssetsGet.mockReset();
    });
  });

  describe("object lookups", () => {
    it("findObject returns the object with the matching id", () => {
      const comp = new TilemapComponent({ map: testMap });
      const player = comp.findObject(10);
      expect(player?.name).toBe("Player");
      expect(comp.findObject(999)).toBeUndefined();
    });

    it("findObjectByName returns the first matching object across layers", () => {
      const comp = new TilemapComponent({ map: testMap });
      expect(comp.findObjectByName("Player")?.id).toBe(10);
      // Two objects share the name "EnemySpawn"; the lower id wins
      // because object layers iterate in document order.
      expect(comp.findObjectByName("EnemySpawn")?.id).toBe(11);
    });

    it("getAllObjects returns a flat list across every object layer", () => {
      const comp = new TilemapComponent({ map: testMap });
      const all = comp.getAllObjects();
      // 1 wall + 4 interactables
      expect(all).toHaveLength(5);
      const ids = all.map((o) => o.id).sort((a, b) => a - b);
      expect(ids).toEqual([1, 10, 11, 12, 13]);
    });
  });

  describe("auto-keys", () => {
    it("tiledObjectKey builds the documented key shape", () => {
      expect(tiledObjectKey("/assets/dungeon.json", 42)).toBe(
        "/assets/dungeon.json#object:42",
      );
    });

    it("objectKey defaults to the mapKey prefix", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const comp = new TilemapComponent({ mapKey: "/assets/dungeon.json" });
      const player = comp.findObject(10)!;
      expect(comp.objectKey(player)).toBe(
        "/assets/dungeon.json#object:10",
      );
      mocks.mockAssetsGet.mockReset();
    });

    it("objectKey honours explicit keyPrefix", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const comp = new TilemapComponent({
        mapKey: "/assets/dungeon.json",
        keyPrefix: "level1",
      });
      const player = comp.findObject(10)!;
      expect(comp.objectKey(player)).toBe("level1#object:10");
      mocks.mockAssetsGet.mockReset();
    });

    it("objectKey throws when no prefix is available", () => {
      const comp = new TilemapComponent({ map: testMap });
      const player = comp.findObject(10)!;
      expect(() => comp.objectKey(player)).toThrow(/keyPrefix/);
    });

    it("forEachObject yields every object on the named layer with its key", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const comp = new TilemapComponent({ mapKey: "/assets/dungeon.json" });
      const seen: Array<[number, string]> = [];
      comp.forEachObject("interactables", (obj, key) => {
        seen.push([obj.id, key]);
      });
      expect(seen).toEqual([
        [10, "/assets/dungeon.json#object:10"],
        [11, "/assets/dungeon.json#object:11"],
        [12, "/assets/dungeon.json#object:12"],
        [13, "/assets/dungeon.json#object:13"],
      ]);
      mocks.mockAssetsGet.mockReset();
    });

    it("forEachObject without a layer name iterates every object layer", () => {
      mocks.mockAssetsGet.mockReturnValue(testMap);
      const comp = new TilemapComponent({ mapKey: "/assets/dungeon.json" });
      const ids: number[] = [];
      comp.forEachObject(undefined, (obj) => ids.push(obj.id));
      expect(ids.sort((a, b) => a - b)).toEqual([1, 10, 11, 12, 13]);
      mocks.mockAssetsGet.mockReset();
    });

    it("forEachObject throws when no key prefix is available", () => {
      const comp = new TilemapComponent({ map: testMap });
      expect(() => comp.forEachObject("interactables", () => {})).toThrow(
        /keyPrefix/,
      );
    });
  });

  describe("ref resolution", () => {
    it("resolveRef walks the full object set so callers don't have to", () => {
      const comp = new TilemapComponent({ map: testMap });
      const ctrl = comp.findObject(13)!;
      // `spawns[0]` refers to id 11 — verify via resolveRefArray below;
      // spot-check single-ref resolution by aliasing one slot.
      expect(comp.resolveRefArray(ctrl, "spawns").map((o) => o.id)).toEqual([
        11, 12,
      ]);
    });

    it("resolveRefArray returns the referenced objects in index order", () => {
      const comp = new TilemapComponent({ map: testMap });
      const ctrl = comp.findObject(13)!;
      const spawns = comp.resolveRefArray(ctrl, "spawns");
      expect(spawns).toHaveLength(2);
      expect(spawns[0]!.id).toBe(11);
      expect(spawns[1]!.id).toBe(12);
    });

    it("getProperty / getPropertyArray pass through for object props", () => {
      const comp = new TilemapComponent({ map: testMap });
      const spawn = comp.findObject(11)!;
      expect(comp.getProperty<string>(spawn, "type")).toBe("Bat");
      expect(comp.getProperty<number>(spawn, "count")).toBe(3);
      const ctrl = comp.findObject(13)!;
      expect(comp.getPropertyArray<number>(ctrl, "spawns")).toEqual([11, 12]);
    });
  });
});
