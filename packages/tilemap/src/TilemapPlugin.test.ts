import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  const cacheMap = new Map<string, unknown>();

  class MockTexture {
    readonly source: unknown;
    readonly frame: unknown;

    constructor(options: { source: unknown; frame: unknown }) {
      this.source = options.source;
      this.frame = options.frame;
    }

    static from(key: string): unknown {
      return cacheMap.get(key);
    }
  }

  class MockRectangle {
    constructor(
      readonly x: number,
      readonly y: number,
      readonly width: number,
      readonly height: number,
    ) {}
  }

  class MockCompositeTilemap {
    readonly calls: { texture: unknown }[] = [];

    tile(texture: unknown): this {
      this.calls.push({ texture });
      return this;
    }
  }

  /** Whatever `Assets.load(path)` should resolve to, per path. */
  const sources = new Map<string, unknown>();

  return {
    mocks: {
      cacheMap,
      sources,
      MockTexture,
      MockRectangle,
      MockCompositeTilemap,
    },
  };
});

vi.mock("pixi.js", () => ({
  extensions: { add: vi.fn() },
  ExtensionType: { LoadParser: "load-parser", Asset: "asset" },
  LoaderParserPriority: { High: 1 },
  Assets: {
    cache: {
      has: (key: string) => mocks.cacheMap.has(key),
      get: (key: string) => mocks.cacheMap.get(key),
      set: (key: string, value: unknown) => void mocks.cacheMap.set(key, value),
    },
    get: (key: string) => mocks.cacheMap.get(key),
    load: async (key: string) => {
      const asset = mocks.sources.get(key) ?? { source: { label: key } };
      mocks.cacheMap.set(key, asset);
      return asset;
    },
    unload: (key: string) => void mocks.cacheMap.delete(key),
  },
  path: {
    dirname: (value: string) =>
      value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : ".",
    extname: (value: string) => value.slice(value.lastIndexOf(".")),
    join: (...segments: string[]) => segments.join("/"),
  },
  Texture: mocks.MockTexture,
  Rectangle: mocks.MockRectangle,
}));

vi.mock("@pixi/tilemap", () => ({
  CompositeTilemap: mocks.MockCompositeTilemap,
}));

vi.mock("./patch-tilemap-pipe.js", () => ({ patchTilemapPipe: vi.fn() }));

import { AssetManager, AssetManagerKey, EngineContext } from "@yagejs/core";
import { texture } from "@yagejs/renderer";
import { TilemapPlugin } from "./TilemapPlugin.js";
import { tiledMap } from "./assets.js";
import { createTilemapLayers } from "./tiled/parseTiledMap.js";
import type { TiledMapData } from "./tiled/types.js";

const IMAGE = "maps/terrain.png";
const TILESET = "tilesets/terrain.tsj";

/** A one-tile map whose embedded tileset already carries a resolved image. */
function sharedTilesetMap(): TiledMapData {
  return {
    width: 1,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      {
        type: "tilelayer",
        data: [1],
        width: 1,
        height: 1,
        id: 1,
        name: "ground",
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
          name: "terrain",
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 1,
          image: "terrain.png",
          resolvedImage: IMAGE,
        },
      },
    ],
  };
}

function install(): AssetManager {
  const assets = new AssetManager();
  assets.registerLoader("texture", {
    load: async (path: string) => {
      const asset = { source: { label: path } };
      mocks.cacheMap.set(path, asset);
      return asset;
    },
    unload: (path: string) => void mocks.cacheMap.delete(path),
  });
  const context = new EngineContext();
  context.register(AssetManagerKey, assets);
  new TilemapPlugin().install(context);
  return assets;
}

describe("TilemapPlugin tiledMap loader", () => {
  beforeEach(() => {
    mocks.cacheMap.clear();
    mocks.sources.clear();
    mocks.sources.set("maps/a.json", sharedTilesetMap());
    mocks.sources.set("maps/b.json", sharedTilesetMap());
  });

  it("loads a map's tileset images with it", async () => {
    const assets = install();

    await assets.loadAll([tiledMap("maps/a.json")]);

    expect(assets.has(texture(IMAGE))).toBe(true);
    expect(mocks.cacheMap.has(IMAGE)).toBe(true);
  });

  it("releases an external tileset's JSON with the map", async () => {
    const map = sharedTilesetMap();
    map.tilesets[0]!.source = "../tilesets/terrain.tsj";
    map.tilesets[0]!.resolvedSource = TILESET;
    mocks.sources.set("maps/a.json", map);
    mocks.cacheMap.set(TILESET, { name: "terrain" });
    const assets = install();
    const handle = tiledMap("maps/a.json");
    await assets.loadAll([handle]);

    assets.unload(handle);

    expect(mocks.cacheMap.has(TILESET)).toBe(false);
  });

  it("keeps a shared tileset image until the last map releases it", async () => {
    const assets = install();
    const mapA = tiledMap("maps/a.json");
    const mapB = tiledMap("maps/b.json");
    await assets.loadAll([mapA, mapB]);

    assets.unload(mapA);

    // The image is counted, so B still draws from it.
    expect(assets.has(texture(IMAGE))).toBe(true);
    const [layer] = createTilemapLayers(assets.get(mapB)).layers;
    expect(
      (layer as unknown as InstanceType<typeof mocks.MockCompositeTilemap>)
        .calls,
    ).toHaveLength(1);

    assets.unload(mapB);

    expect(assets.has(texture(IMAGE))).toBe(false);
    expect(mocks.cacheMap.has(IMAGE)).toBe(false);
    expect(mocks.cacheMap.has("maps/b.json")).toBe(false);
  });
});
