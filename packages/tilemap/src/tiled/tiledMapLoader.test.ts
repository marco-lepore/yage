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
    dirname: (value: string) => value.slice(0, value.lastIndexOf("/")),
    extname: (value: string) => value.slice(value.lastIndexOf(".")),
  },
  Texture: mocks.MockTexture,
  Rectangle: mocks.MockRectangle,
}));

vi.mock("@pixi/tilemap", () => ({
  CompositeTilemap: mocks.MockCompositeTilemap,
}));

import { createTilemapLayers } from "./parseTiledMap.js";
import { tiledMapAssetExtension } from "./tiledMapLoader.js";
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

  it("resolves embedded tilesets and creates their subtextures", async () => {
    const map = loadFixture("embedded.json");
    const ref = map.tilesets[0]!;
    const parser = tiledMapAssetExtension.loader as TestLoaderParser;

    await parser.parse(map, { src: "maps/embedded.json" }, {});

    expect(ref.data).toMatchObject({
      name: "embedded terrain",
      image: "terrain.png",
    });
    expect(ref.data).not.toBe(ref);
    expect(mocks.load).toHaveBeenCalledWith("maps/terrain.png");
    expect(mocks.cache.has("terrain.png:0")).toBe(true);

    const [layer] = createTilemapLayers(map);
    const calls = (
      layer as unknown as InstanceType<typeof mocks.MockCompositeTilemap>
    ).calls;
    expect(calls).toHaveLength(1);
  });
});
