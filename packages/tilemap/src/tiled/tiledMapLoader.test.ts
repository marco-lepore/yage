import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  const cacheMap = new Map<string, unknown>();
  const cache = {
    has: (key: string) => cacheMap.has(key),
    get: (key: string) => cacheMap.get(key),
    set: (key: string, value: unknown) => void cacheMap.set(key, value),
  };
  const load = vi.fn(async () => ({ source: { label: "base source" } }));

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
    readonly calls: { texture: unknown; x: number; y: number }[] = [];

    tile(texture: unknown, x: number, y: number): this {
      this.calls.push({ texture, x, y });
      return this;
    }
  }

  return {
    mocks: {
      cache,
      cacheMap,
      load,
      MockTexture,
      MockRectangle,
      MockCompositeTilemap,
    },
  };
});

vi.mock("pixi.js", () => ({
  ExtensionType: { LoadParser: "load-parser", Asset: "asset" },
  LoaderParserPriority: { High: 1 },
  Assets: {
    cache: mocks.cache,
    load: mocks.load,
    get: (key: string) => mocks.cache.get(key),
  },
  path: {
    dirname: (value: string) =>
      value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : ".",
    extname: (value: string) => value.slice(value.lastIndexOf(".")),
    // Pixi's `path.join` normalises the result; the tests need that much of it.
    join: (...segments: string[]) => {
      const parts: string[] = [];
      for (const segment of segments.join("/").split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === ".." && parts.length > 0 && parts.at(-1) !== "..") {
          parts.pop();
          continue;
        }
        parts.push(segment);
      }
      return parts.join("/");
    },
  },
  Texture: mocks.MockTexture,
  Rectangle: mocks.MockRectangle,
}));

vi.mock("@pixi/tilemap", () => ({
  CompositeTilemap: mocks.MockCompositeTilemap,
}));

import { createTilemapLayers } from "./parseTiledMap.js";
import {
  externalTilesetPaths,
  tiledMapAssetExtension,
  tilesetImagePaths,
} from "./tiledMapLoader.js";
import { loadFixture } from "./fixtures/loadFixture.js";
import type { TiledMapData } from "./types.js";

interface TestLoaderParser {
  parse(
    asset: TiledMapData,
    resolvedAsset: { src: string },
    loader: object,
  ): Promise<TiledMapData>;
}

describe("tiledMapLoader", () => {
  beforeEach(() => {
    mocks.cacheMap.clear();
    mocks.load.mockClear();
  });

  it("resolves embedded tilesets and records their image path", async () => {
    const map = loadFixture("embedded.json");
    const ref = map.tilesets[0]!;
    const parser = tiledMapAssetExtension.loader as TestLoaderParser;

    await parser.parse(map, { src: "maps/embedded.json" }, {});

    expect(ref.data).toMatchObject({
      name: "embedded terrain",
      image: "terrain.png",
      resolvedImage: "maps/terrain.png",
    });
    expect(ref.data).not.toBe(ref);
    // The parser resolves tilesets; the asset manager's loader owns the images.
    expect(mocks.load).not.toHaveBeenCalled();
    expect(tilesetImagePaths(map)).toEqual(["maps/terrain.png"]);

    mocks.cacheMap.set("maps/terrain.png", {
      source: { label: "terrain source" },
    });
    const [layer] = createTilemapLayers(map).layers;
    const calls = (
      layer as unknown as InstanceType<typeof mocks.MockCompositeTilemap>
    ).calls;
    expect(calls).toHaveLength(1);
  });

  it("resolves an external tileset's image against the tileset's own folder", async () => {
    const map = {
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      layers: [],
      tilesets: [{ firstgid: 1, source: "../tilesets/terrain.tsj" }],
    } as unknown as TiledMapData;
    const tilesetData = {
      name: "terrain",
      tilewidth: 16,
      tileheight: 16,
      tilecount: 1,
      columns: 1,
      image: "terrain.png",
    };
    const loader = {
      load: async ({ src }: { src: string }) => {
        expect(src).toBe("tilesets/terrain.tsj");
        return tilesetData;
      },
    };
    const parser = tiledMapAssetExtension.loader as TestLoaderParser;

    await parser.parse(map, { src: "maps/level.json" }, loader);

    expect(tilesetImagePaths(map)).toEqual(["tilesets/terrain.png"]);
    expect(externalTilesetPaths(map)).toEqual(["tilesets/terrain.tsj"]);
  });

  it("reports no external tileset for an embedded one", () => {
    const map = {
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      layers: [],
      tilesets: [{ firstgid: 1, data: { image: "terrain.png" } }],
    } as unknown as TiledMapData;

    expect(externalTilesetPaths(map)).toEqual([]);
  });

  it("reports one image for two tilesets that share it", async () => {
    const map = {
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      layers: [],
      tilesets: [
        {
          firstgid: 1,
          name: "a",
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 1,
          image: "terrain.png",
        },
        {
          firstgid: 2,
          name: "b",
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 1,
          image: "terrain.png",
        },
      ],
    } as unknown as TiledMapData;
    const parser = tiledMapAssetExtension.loader as TestLoaderParser;

    await parser.parse(map, { src: "maps/level.json" }, {});

    expect(tilesetImagePaths(map)).toEqual(["maps/terrain.png"]);
  });
});
