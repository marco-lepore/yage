import {
  ExtensionType,
  LoaderParserPriority,
  Assets,
  path,
  Texture,
  Rectangle,
} from "pixi.js";
import type { LoaderParser, ResolvedAsset, Loader } from "pixi.js";
import type { TiledMapData, TilesetData, TilesetRef } from "./types.js";

/**
 * PixiJS loader extension that detects Tiled map JSON files and resolves
 * their tileset references.
 *
 * Supports two tileset formats:
 * 1. **Collection-of-images** — tileset has `tiles[]` with image paths.
 *    Assumes textures are already in the PixiJS cache (e.g. from a
 *    pre-loaded spritesheet atlas).
 * 2. **Single-image tileset** — tileset has an `image` property pointing
 *    to a spritesheet. The loader loads the image and creates sub-textures
 *    for each tile based on grid layout.
 */
const tiledMapLoaderParser: LoaderParser<TiledMapData> = {
  id: "tiledMapLoader",

  extension: {
    type: ExtensionType.LoadParser,
    priority: LoaderParserPriority.High,
  },

  async testParse(
    asset: TiledMapData,
    resolvedAsset?: ResolvedAsset,
  ): Promise<boolean> {
    if (!resolvedAsset?.src) return false;
    if (path.extname(resolvedAsset.src).toLowerCase() !== ".json") return false;
    const obj = asset as unknown as Record<string, unknown>;
    return !!(obj.tilesets && obj.layers);
  },

  async parse(
    asset: TiledMapData,
    resolvedAsset?: ResolvedAsset,
    loader?: Loader,
  ): Promise<TiledMapData> {
    const src = resolvedAsset?.src;
    if (!src || !loader) return asset;

    let basePath = path.dirname(src);
    if (basePath && !basePath.endsWith("/")) {
      basePath += "/";
    }

    for (const tilesetRef of asset.tilesets as TilesetRef[]) {
      if (tilesetRef.source) {
        // External tileset JSON — load it
        const tilesetPath = basePath + tilesetRef.source;
        const tilesetData = (await loader.load<TilesetData>({
          src: tilesetPath,
        })) as TilesetData;
        tilesetRef.data = tilesetData;
      }

      const tileset = tilesetRef.data;
      if (!tileset) continue;

      // Single-image tileset: load the image and create sub-textures
      if (tileset.image && !tileset.tiles?.length) {
        const imagePath = basePath + tileset.image;
        const baseTexture = await Assets.load<Texture>(imagePath);
        const cols = tileset.columns;
        const tw = tileset.tilewidth;
        const th = tileset.tileheight;
        const margin = tileset.margin ?? 0;
        const spacing = tileset.spacing ?? 0;

        for (let id = 0; id < tileset.tilecount; id++) {
          const col = id % cols;
          const row = Math.floor(id / cols);
          const x = margin + col * (tw + spacing);
          const y = margin + row * (th + spacing);

          const frame = new Rectangle(x, y, tw, th);
          const subtex = new Texture({
            source: baseTexture.source,
            frame,
          });

          // Store subtexture in PixiJS cache with a key like "tileset-name:id"
          const cacheKey = `${tileset.name}:${id}`;
          Assets.cache.set(cacheKey, subtex);
        }
      }
      // Collection-of-images: textures are expected to already be
      // in the PixiJS cache (loaded via spritesheet atlas).
    }

    return asset;
  },

  unload() {},
};

/** PixiJS asset extension bundle for Tiled map JSON files. */
export const tiledMapAssetExtension = {
  extension: ExtensionType.Asset,
  loader: tiledMapLoaderParser,
};
