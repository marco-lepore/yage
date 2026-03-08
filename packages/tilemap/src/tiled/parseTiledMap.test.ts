import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock PixiJS and @pixi/tilemap before importing modules
const { mockCompositeTilemap, mockAssets, mockRectangle } = vi.hoisted(() => {
  class MockCompositeTilemap {
    tile(_texture: unknown, _x: number, _y: number) {
      return this;
    }
  }

  const textureCache = new Map<string, unknown>();

  const mockAssets = {
    get: vi.fn((key: string) => textureCache.get(key)),
    _cache: textureCache,
  };

  class MockRectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  }

  return { mockCompositeTilemap: MockCompositeTilemap, mockAssets, mockRectangle: MockRectangle };
});

vi.mock("@pixi/tilemap", () => ({
  CompositeTilemap: mockCompositeTilemap,
}));

vi.mock("pixi.js", () => ({
  Assets: mockAssets,
  Texture: vi.fn(),
  Rectangle: mockRectangle,
}));

import { createTilemapLayers, extractObjects, toTilemapData } from "./parseTiledMap.js";
import type { TiledMapData, TileLayer, ObjectGroup } from "./types.js";

function makeTileLayer(name: string, data: number[], width: number): TileLayer {
  return {
    type: "tilelayer",
    data,
    width,
    height: Math.ceil(data.length / width),
    id: 1,
    name,
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
  };
}

describe("createTilemapLayers", () => {
  beforeEach(() => {
    mockAssets._cache.clear();
  });

  it("creates one CompositeTilemap per tile layer", () => {
    // Set up a collection-of-images tileset
    const fakeTexture = { label: "tile0.png" };
    mockAssets._cache.set("tile0.png", fakeTexture);

    const map: TiledMapData = {
      width: 2,
      height: 2,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        makeTileLayer("ground", [1, 0, 0, 1], 2),
        makeTileLayer("walls", [0, 1, 1, 0], 2),
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

    const result = createTilemapLayers(map);
    expect(result).toHaveLength(2);
  });

  it("filters layers by name", () => {
    const fakeTexture = { label: "tile0.png" };
    mockAssets._cache.set("tile0.png", fakeTexture);

    const map: TiledMapData = {
      width: 2,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        makeTileLayer("ground", [1, 1], 2),
        makeTileLayer("walls", [1, 1], 2),
        makeTileLayer("deco", [1, 1], 2),
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

    const result = createTilemapLayers(map, ["ground", "deco"]);
    expect(result).toHaveLength(2);
  });

  it("skips empty tiles (GID 0)", () => {
    const fakeTexture = { label: "tile0.png" };
    mockAssets._cache.set("tile0.png", fakeTexture);

    const map: TiledMapData = {
      width: 3,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      layers: [makeTileLayer("ground", [0, 1, 0], 3)],
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

    const result = createTilemapLayers(map);
    expect(result).toHaveLength(1);
    // The CompositeTilemap should only have 1 tile call (for index 1)
  });

  it("throws when no tileset matches a GID", () => {
    const map: TiledMapData = {
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      layers: [makeTileLayer("ground", [99], 1)],
      tilesets: [],
    };

    expect(() => createTilemapLayers(map)).toThrow("No tileset found");
  });
});

describe("extractObjects", () => {
  it("groups objects by class/type/name", () => {
    const map: TiledMapData = {
      width: 10,
      height: 10,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        {
          type: "objectgroup",
          id: 1,
          name: "objects",
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: [
            { id: 1, name: "spawn1", class: "EnemySpawn", x: 0, y: 0, width: 0, height: 0, rotation: 0, visible: true, point: true },
            { id: 2, name: "spawn2", class: "EnemySpawn", x: 32, y: 32, width: 0, height: 0, rotation: 0, visible: true, point: true },
            { id: 3, name: "door", type: "Door", x: 64, y: 0, width: 16, height: 32, rotation: 0, visible: true },
          ],
        } as ObjectGroup,
      ],
      tilesets: [],
    };

    const objects = extractObjects(map);
    expect(objects["EnemySpawn"]).toHaveLength(2);
    expect(objects["Door"]).toHaveLength(1);
  });

  it("filters by object layer name", () => {
    const map: TiledMapData = {
      width: 10,
      height: 10,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        {
          type: "objectgroup",
          id: 1,
          name: "spawns",
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: [
            { id: 1, name: "s1", class: "Spawn", x: 0, y: 0, width: 0, height: 0, rotation: 0, visible: true, point: true },
          ],
        } as ObjectGroup,
        {
          type: "objectgroup",
          id: 2,
          name: "triggers",
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: [
            { id: 2, name: "t1", class: "Trigger", x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true },
          ],
        } as ObjectGroup,
      ],
      tilesets: [],
    };

    const spawns = extractObjects(map, "spawns");
    expect(Object.keys(spawns)).toEqual(["Spawn"]);

    const triggers = extractObjects(map, "triggers");
    expect(Object.keys(triggers)).toEqual(["Trigger"]);
  });

  it("falls back to type then name for grouping key", () => {
    const map: TiledMapData = {
      width: 10,
      height: 10,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        {
          type: "objectgroup",
          id: 1,
          name: "objects",
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: [
            { id: 1, name: "myObj", type: "Wall", x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true },
            { id: 2, name: "unnamed", x: 0, y: 0, width: 16, height: 16, rotation: 0, visible: true },
          ],
        } as ObjectGroup,
      ],
      tilesets: [],
    };

    const objects = extractObjects(map);
    expect(objects["Wall"]).toHaveLength(1);
    expect(objects["unnamed"]).toHaveLength(1);
  });
});

describe("toTilemapData", () => {
  it("converts TiledMapData to generic TilemapData", () => {
    const map: TiledMapData = {
      width: 10,
      height: 8,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        {
          type: "tilelayer",
          data: [1, 2, 3],
          width: 3,
          height: 1,
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
          name: "objects",
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: [
            { id: 1, name: "wall", class: "Wall", x: 10, y: 20, width: 32, height: 16, rotation: 45, visible: true },
            { id: 2, name: "spawn", type: "Spawn", x: 50, y: 60, width: 0, height: 0, rotation: 0, visible: true, point: true },
          ],
        } as ObjectGroup,
      ],
      tilesets: [],
    };

    const result = toTilemapData(map);
    expect(result.width).toBe(10);
    expect(result.height).toBe(8);
    expect(result.tileWidth).toBe(16);
    expect(result.tileHeight).toBe(16);

    expect(result.tileLayers).toHaveLength(1);
    expect(result.tileLayers[0]!.name).toBe("ground");
    expect(result.tileLayers[0]!.data).toEqual([1, 2, 3]);

    expect(result.objectLayers).toHaveLength(1);
    expect(result.objectLayers[0]!.name).toBe("objects");
    expect(result.objectLayers[0]!.objects).toHaveLength(2);

    const wall = result.objectLayers[0]!.objects[0]!;
    expect(wall.class).toBe("Wall");
    expect(wall.rotation).toBe(45);

    const spawn = result.objectLayers[0]!.objects[1]!;
    expect(spawn.class).toBe("Spawn"); // falls back to type
    expect(spawn.point).toBe(true);
  });

  it("maps polygon objects", () => {
    const map: TiledMapData = {
      width: 10,
      height: 10,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        {
          type: "objectgroup",
          id: 1,
          name: "collisions",
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: [
            {
              id: 1, name: "slope", x: 10, y: 20, width: 0, height: 0, rotation: 0, visible: true,
              polygon: [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }],
            },
          ],
        } as ObjectGroup,
      ],
      tilesets: [],
    };

    const result = toTilemapData(map);
    const slope = result.objectLayers[0]!.objects[0]!;
    expect(slope.polygon).toEqual([{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }]);
  });

  it("maps properties", () => {
    const map: TiledMapData = {
      width: 10,
      height: 10,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        {
          type: "objectgroup",
          id: 1,
          name: "objects",
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: [
            {
              id: 1, name: "door", class: "Door", x: 0, y: 0, width: 16, height: 32, rotation: 0, visible: true,
              properties: [
                { name: "locked", type: "bool", value: true },
                { name: "key", type: "string", value: "gold_key" },
              ],
            },
          ],
        } as ObjectGroup,
      ],
      tilesets: [],
    };

    const result = toTilemapData(map);
    const door = result.objectLayers[0]!.objects[0]!;
    expect(door.properties).toEqual([
      { name: "locked", type: "bool", value: true },
      { name: "key", type: "string", value: "gold_key" },
    ]);
  });
});
