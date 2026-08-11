import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock PixiJS and @pixi/tilemap before importing modules
const { mockCompositeTilemap, mockAssets, mockRectangle } = vi.hoisted(() => {
  class MockCompositeTilemap {
    visible = true;
    calls: {
      texture: unknown;
      x: number;
      y: number;
      alpha: number | undefined;
      rotate: number | undefined;
      animX?: number;
      animY?: number;
      animCountX?: number;
      animCountY?: number;
      animDivisor?: number;
    }[] = [];
    tileAnim: [number, number] = [0, 0];

    tile(
      texture: unknown,
      x: number,
      y: number,
      options?: {
        alpha?: number;
        rotate?: number;
        animX?: number;
        animY?: number;
        animCountX?: number;
        animCountY?: number;
        animDivisor?: number;
      },
    ) {
      this.calls.push({
        texture,
        x,
        y,
        alpha: options?.alpha,
        rotate: options?.rotate,
        ...(options?.animX !== undefined && { animX: options.animX }),
        ...(options?.animY !== undefined && { animY: options.animY }),
        ...(options?.animCountX !== undefined && {
          animCountX: options.animCountX,
        }),
        ...(options?.animCountY !== undefined && {
          animCountY: options.animCountY,
        }),
        ...(options?.animDivisor !== undefined && {
          animDivisor: options.animDivisor,
        }),
      });
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

import {
  _tilemapLayerHasAnimation,
  createTilemapLayers,
  extractObjectGroups,
  extractObjects,
  toTilemapData,
} from "./parseTiledMap.js";
import { getProperty, getPropertyArray } from "../properties.js";
import { loadFixture } from "./fixtures/loadFixture.js";
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

  it("renders tiles from an embedded tileset", () => {
    const map = loadFixture("embedded.json");
    const fakeTexture = { label: "terrain tile" };
    mockAssets._cache.set("terrain.png:0", fakeTexture);

    const [layer] = createTilemapLayers(map);
    const calls = (
      layer as unknown as InstanceType<typeof mockCompositeTilemap>
    ).calls;
    expect(calls).toEqual([
      { texture: fakeTexture, x: 0, y: 0, alpha: 1, rotate: 0 },
    ]);
  });

  it("renders each of Tiled's eight flip combinations", () => {
    const map = loadFixture("flipped.json");
    const fakeTexture = { label: "tile" };
    mockAssets._cache.set("tile.png", fakeTexture);

    const [layer] = createTilemapLayers(map);
    const calls = (
      layer as unknown as InstanceType<typeof mockCompositeTilemap>
    ).calls;

    // Eight tiles of the same tile id, one per Tiled flag combination.
    expect(calls).toHaveLength(8);
    expect(calls.every((c) => c.texture === fakeTexture)).toBe(true);
    expect(calls.map(({ rotate }) => rotate)).toEqual([
      0, 12, 8, 4, 10, 6, 2, 14,
    ]);
  });

  it("renders a single-image tileset that also carries a tiles array", () => {
    // Tiled writes `tiles[]` on a single-image tileset as soon as one tile has
    // an animation, class, custom property or collision shape.
    const map = loadFixture("animated-parallax.json");
    const fakeTexture = { label: "terrain tile" };
    mockAssets._cache.set("terrain.png:0", fakeTexture);

    const [layer] = createTilemapLayers(map);
    const calls = (
      layer as unknown as InstanceType<typeof mockCompositeTilemap>
    ).calls;
    expect(calls.map(({ texture }) => texture)).toEqual([fakeTexture]);
  });

  it("passes a conforming horizontal animation to the tilemap shader", () => {
    const map = loadFixture("animation-horizontal.json");
    const fakeTexture = { label: "horizontal tile" };
    mockAssets._cache.set("horizontal.png:0", fakeTexture);

    const [layer] = createTilemapLayers(map);
    const calls = (
      layer as unknown as InstanceType<typeof mockCompositeTilemap>
    ).calls;
    expect(calls).toHaveLength(2);
    expect(layer ? _tilemapLayerHasAnimation(layer) : false).toBe(true);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          animX: 18,
          animY: 0,
          animCountX: 3,
          animCountY: 3,
          animDivisor: 100,
        }),
      ]),
    );
    expect(toTilemapData(map).diagnostics).toEqual([]);
  });

  it("draws an animated tile with its first frame, not the tile the gid names", () => {
    // Tiled allows an animation authored on tile 2 to start on tile 0. The
    // shader steps forward from the drawn image, so starting from tile 2's
    // image would play tiles 2 and 3 instead of 0 and 1.
    const map = loadFixture("animation-offset-start.json");
    const firstFrame = { label: "frame 0" };
    const ownImage = { label: "tile 2" };
    mockAssets._cache.set("terrain.png:0", firstFrame);
    mockAssets._cache.set("terrain.png:2", ownImage);

    const [layer] = createTilemapLayers(map);
    const call = (layer as unknown as InstanceType<typeof mockCompositeTilemap>)
      .calls[0];
    expect(call?.texture).toBe(firstFrame);
    expect(call).toEqual(
      expect.objectContaining({ animX: 16, animCountX: 2, animDivisor: 120 }),
    );
  });

  it("passes a conforming vertical animation to the tilemap shader", () => {
    const map = loadFixture("animation-vertical.json");
    const fakeTexture = { label: "vertical tile" };
    mockAssets._cache.set("vertical.png:0", fakeTexture);

    const [layer] = createTilemapLayers(map);
    const call = (layer as unknown as InstanceType<typeof mockCompositeTilemap>)
      .calls[0];
    expect(call).toEqual(
      expect.objectContaining({
        animX: 0,
        animY: 16,
        animCountX: 3,
        animCountY: 3,
        animDivisor: 120,
      }),
    );
  });

  it.each([
    [
      "animation-unequal-durations.json",
      "unequal.png:0",
      "Frame durations differ (100, 200 ms)",
    ],
    ["animation-uneven-stride.json", "uneven.png:0", "Frame stride varies"],
    [
      "animation-collection.json",
      "water-0.png",
      "Each tile is stored in a separate image",
    ],
  ])(
    "renders the first frame without animation options for %s",
    (fixture, textureKey, reason) => {
      const map = loadFixture(fixture);
      mockAssets._cache.set(textureKey, { label: "first frame" });

      const [layer] = createTilemapLayers(map);
      const call = (
        layer as unknown as InstanceType<typeof mockCompositeTilemap>
      ).calls[0];
      expect(call).not.toHaveProperty("animX");
      expect(call).not.toHaveProperty("animY");
      expect(call).not.toHaveProperty("animDivisor");
      expect(layer ? _tilemapLayerHasAnimation(layer) : false).toBe(false);
      expect(toTilemapData(map).diagnostics).toEqual([
        expect.objectContaining({
          code: "unsupported-tile-animation",
          severity: "warning",
          message: expect.stringContaining(`Tile 0: ${reason}`),
        }),
      ]);
    },
  );

  it("treats a single-frame animation as a still tile", () => {
    const map = loadFixture("animation-single-frame.json");
    mockAssets._cache.set("single.png:0", { label: "still tile" });

    const [layer] = createTilemapLayers(map);
    const call = (layer as unknown as InstanceType<typeof mockCompositeTilemap>)
      .calls[0];
    expect(call).not.toHaveProperty("animX");
    expect(call).not.toHaveProperty("animY");
    expect(call).not.toHaveProperty("animDivisor");
    expect(layer ? _tilemapLayerHasAnimation(layer) : false).toBe(false);
    expect(toTilemapData(map).diagnostics).toEqual([]);
  });

  it("hides a layer hidden in Tiled and bakes layer opacity into its tiles", () => {
    const map = loadFixture("hidden-dimmed.json");
    const fakeTexture = { label: "tile" };
    mockAssets._cache.set("tile.png", fakeTexture);

    const [hidden, dimmed] = createTilemapLayers(map);
    expect(
      (hidden as unknown as InstanceType<typeof mockCompositeTilemap>).visible,
    ).toBe(false);
    expect(
      (dimmed as unknown as InstanceType<typeof mockCompositeTilemap>).calls.map(
        ({ alpha }) => alpha,
      ),
    ).toEqual([0.5]);
  });

  it("composes tile layer and owning tileset offsets", () => {
    const map = loadFixture("offsets.json");
    const fakeTexture = { label: "tile" };
    mockAssets._cache.set("tile.png", fakeTexture);

    const [layer] = createTilemapLayers(map);
    const calls = (
      layer as unknown as InstanceType<typeof mockCompositeTilemap>
    ).calls;
    expect(calls.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 5, y: 1 },
      { x: 21, y: 1 },
    ]);
  });

  it("sits a tile on the bottom edge of its cell whatever its image size", () => {
    const map = loadFixture("oversized-tiles.json");
    mockAssets._cache.set("tall.png:0", { label: "wall" });
    mockAssets._cache.set("stump.png", { label: "stump" });
    mockAssets._cache.set("pine.png", { label: "pine" });
    mockAssets._cache.set("coin.png", { label: "coin" });

    const [layer] = createTilemapLayers(map);
    const calls = (
      layer as unknown as InstanceType<typeof mockCompositeTilemap>
    ).calls;

    // On a 16px grid: the 48px-tall wall overhangs two cells upward, the 16px
    // stump fills its cell, the 64px pine overhangs three, and the 8px coin
    // sits in the lower half of its own. The pine is also 32px wide and still
    // starts at its cell's left edge.
    expect(calls.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: -32 },
      { x: 16, y: 0 },
      { x: 32, y: -48 },
      { x: 48, y: 8 },
    ]);
  });

  it("names an unresolved embedded tileset by firstgid", () => {
    const map: TiledMapData = {
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      layers: [makeTileLayer("ground", [1], 1)],
      tilesets: [{ firstgid: 1 }],
    };

    expect(() => createTilemapLayers(map)).toThrow('tileset "firstgid 1"');
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

describe("extractObjectGroups", () => {
  it("preserves layer and class namespaces in source order", () => {
    const map = loadFixture("object-groups.json");

    const groups = extractObjectGroups(map);
    expect(
      groups.map((group) => ({
        layer: group.layer,
        class: group.class,
        ids: group.objects.map((object) => object.id),
      })),
    ).toEqual([
      { layer: "entrances", class: "Spawn", ids: [1] },
      { layer: "entrances", class: undefined, ids: [2] },
      { layer: "exits", class: "Spawn", ids: [3] },
      { layer: "exits", class: undefined, ids: [4] },
    ]);
  });

  it("filters groups by object layer name", () => {
    const groups = extractObjectGroups(
      loadFixture("object-groups.json"),
      "exits",
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.layer === "exits")).toBe(true);
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

  it("maps polyline objects", () => {
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
              id: 1, name: "ledge", x: 10, y: 20, width: 0, height: 0, rotation: 0, visible: true,
              polyline: [{ x: 0, y: 0 }, { x: 48, y: 16 }],
            },
          ],
        } as ObjectGroup,
      ],
      tilesets: [],
    };

    const result = toTilemapData(map);
    const ledge = result.objectLayers[0]!.objects[0]!;
    expect(ledge.polyline).toEqual([{ x: 0, y: 0 }, { x: 48, y: 16 }]);
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

  it("copies map, layer, and tileset properties without aliasing", () => {
    const map = loadFixture("properties.json");
    const result = toTilemapData(map);
    const tileLayer = map.layers[0];
    const objectLayer = map.layers[1];
    if (tileLayer?.type !== "tilelayer") throw new Error("Missing tile layer");
    if (objectLayer?.type !== "objectgroup") {
      throw new Error("Missing object layer");
    }

    expect(getProperty<string>(result, "biome")).toBe("forest");
    expect(getPropertyArray<string>(result, "music")).toEqual(["day", "night"]);
    expect(getProperty<number>(result.tileLayers[0]!, "parallax")).toBe(0.5);
    expect(getProperty<string>(result.objectLayers[0]!, "purpose")).toBe(
      "spawns",
    );
    expect(getProperty<string>(result.tilesets[0]!, "material")).toBe("grass");
    expect(result.tilesets[0]?.name).toBe("terrain");
    expect(result.properties).not.toBe(map.properties);
    expect(result.tileLayers[0]?.properties).not.toBe(tileLayer.properties);
    expect(result.objectLayers[0]?.properties).not.toBe(objectLayer.properties);
    expect(result.tilesets[0]?.properties).not.toBe(
      map.tilesets[0]?.properties,
    );
  });

  it("omits absent properties and still lists referenced tilesets", () => {
    const result = toTilemapData(loadFixture("clean.json"));

    expect(result).not.toHaveProperty("properties");
    expect(result.tileLayers[0]).not.toHaveProperty("properties");
    expect(result.objectLayers[0]).not.toHaveProperty("properties");
    expect(result.tilesets).toEqual([{ firstGid: 1, name: "terrain" }]);
    expect(result.tilesets[0]).not.toHaveProperty("properties");
  });

  it("lists embedded tilesets by name", () => {
    expect(toTilemapData(loadFixture("embedded.json")).tilesets).toEqual([
      { firstGid: 1, name: "embedded terrain" },
    ]);
  });

  it("carries a tile object's gid, leaving other objects without one", () => {
    const result = toTilemapData(loadFixture("tile-objects.json"));
    const [crate, marker] = result.objectLayers[0]!.objects;

    // The crate's y is its bottom edge, which is what Tiled wrote.
    expect(crate).toMatchObject({ gid: 5, x: 32, y: 64, height: 32 });
    expect(marker).not.toHaveProperty("gid");
  });

  it("applies object layer offsets and records both layer offsets", () => {
    const result = toTilemapData(loadFixture("offsets.json"));

    expect(result.tileLayers[0]).toMatchObject({ offsetX: 3, offsetY: 5 });
    expect(result.objectLayers[0]).toMatchObject({ offsetX: 7, offsetY: 11 });
    expect(result.objectLayers[0]?.objects[0]).toMatchObject({ x: 17, y: 31 });
  });
});
