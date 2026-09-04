import { ExtensionType, LoaderParserPriority, path } from "pixi.js";
import type { LoaderParser, ResolvedAsset, Loader } from "pixi.js";
import type { TiledMapData, TilesetData, TilesetRef } from "./types.js";
import { resolveTilesetData } from "./resolveTilesetData.js";

/**
 * PixiJS loader extension that detects Tiled map JSON files and resolves
 * their tileset references: an external tileset's JSON is loaded and inlined,
 * and every single-image tileset records where its image lives relative to
 * the file that names it (`TilesetData.resolvedImage`).
 *
 * It loads no images itself. The `"tiledMap"` loader the plugin registers with
 * the asset manager loads them as counted `texture()` handles, so a map, a
 * second map sharing the tileset and a sprite on the same sheet each hold
 * their own reference.
 *
 * A collection-of-images tileset names one image per tile and expects those
 * to be in the Pixi cache already, normally as frames of a preloaded atlas.
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

    const mapDir = path.dirname(src);

    for (const tilesetRef of asset.tilesets as TilesetRef[]) {
      let tileset: TilesetData | null;
      // Tiled writes a tileset's `image` relative to the file the tileset
      // itself lives in, so an external tileset resolves its image against its
      // own directory and an embedded one against the map's.
      let imageDir = mapDir;

      if (tilesetRef.source) {
        // External tileset JSON — load it
        const tilesetPath = path.join(mapDir, tilesetRef.source);
        tilesetRef.resolvedSource = tilesetPath;
        imageDir = path.dirname(tilesetPath);
        const tilesetData = (await loader.load<TilesetData>({
          src: tilesetPath,
        })) as TilesetData;
        tilesetRef.data = tilesetData;
        tileset = tilesetData;
      } else {
        tileset = resolveTilesetData(tilesetRef);
        if (tileset) tilesetRef.data = tileset;
      }

      if (!tileset) continue;

      // `image` is what tells the two tileset forms apart. A single-image
      // tileset also carries `tiles[]` once any tile has an animation, class,
      // custom property or collision shape.
      if (tileset.image) {
        tileset.resolvedImage = path.join(imageDir, tileset.image);
      }
    }

    return asset;
  },
};

/**
 * Every distinct tileset image a parsed map draws from, as the keys their
 * textures load under. Empty for a map whose tilesets are all
 * collections of images.
 *
 * @internal
 */
export function tilesetImagePaths(map: TiledMapData): string[] {
  const images = new Set<string>();
  for (const ref of map.tilesets) {
    const image = ref.data?.resolvedImage;
    if (image !== undefined) images.add(image);
  }
  return [...images];
}

/**
 * Every external tileset JSON a parsed map inlined, as the keys they loaded
 * under. Empty for a map whose tilesets are all embedded.
 *
 * @internal
 */
export function externalTilesetPaths(map: TiledMapData): string[] {
  const sources = new Set<string>();
  for (const ref of map.tilesets) {
    if (ref.resolvedSource !== undefined) sources.add(ref.resolvedSource);
  }
  return [...sources];
}

/** PixiJS asset extension bundle for Tiled map JSON files. */
export const tiledMapAssetExtension = {
  extension: ExtensionType.Asset,
  loader: tiledMapLoaderParser,
};
