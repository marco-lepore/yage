import { AssetManagerKey } from "@yagejs/core";
import type { AssetLoader, EngineContext, Plugin } from "@yagejs/core";
import { texture } from "@yagejs/renderer";
import { extensions, Assets } from "pixi.js";
import {
  externalTilesetPaths,
  tiledMapAssetExtension,
  tilesetImagePaths,
} from "./tiled/tiledMapLoader.js";
import type { TiledMapData } from "./tiled/types.js";
import { patchTilemapPipe } from "./patch-tilemap-pipe.js";

/** Plugin that adds Tiled map loading and rendering to YAGE. */
export class TilemapPlugin implements Plugin {
  readonly name = "tilemap";
  readonly version = "2.0.0";
  readonly dependencies = ["renderer"] as const;

  install(context: EngineContext): void {
    // Apply our runtime patch for @pixi/tilemap's TilemapPipe BEFORE any
    // tilemap is rendered. The patch fixes upstream bugs where the pipe
    // (a) reads stale uniforms from `globalUniforms._activeUniforms.at(-1)`
    // after sibling filter/render-group pops and (b) double-applies the
    // RG transform when the tilemap sits inside a sub-render-group. See
    // `patch-tilemap-pipe.ts` for the full rationale.
    patchTilemapPipe();

    // Register PixiJS loader extension for Tiled map JSON files
    extensions.add(tiledMapAssetExtension);

    const am = context.tryResolve(AssetManagerKey);
    if (!am) return;

    // A map handle owns its tileset images. They load as `texture()` handles
    // so the asset manager counts them: a second map on the same tileset, or
    // a sprite drawing from the same sheet, holds its own reference and one
    // map's unload leaves the image standing.
    const loader: AssetLoader<TiledMapData> = {
      load: async (path: string) => {
        const map = await Assets.load<TiledMapData>(path);
        await am.loadAll(tilesetImagePaths(map).map((image) => texture(image)));
        return map;
      },
      unload: (path: string, map: TiledMapData) => {
        for (const image of tilesetImagePaths(map)) am.unload(texture(image));
        // An external tileset's JSON is plain data: a map that inlined it
        // holds its own copy, so dropping the cache entry costs a second map
        // nothing but a re-fetch if it is loaded again.
        for (const source of externalTilesetPaths(map)) Assets.unload(source);
        Assets.unload(path);
      },
    };
    am.registerLoader("tiledMap", loader);
  }
}
