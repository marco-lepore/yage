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
        const images = tilesetImagePaths(map).map((image) => texture(image));
        // Each successful image has its own reference. Wait for every load so
        // a failed map can release exactly those references, including images
        // that finish after another image failed.
        const loaded = await Promise.allSettled(
          images.map((image) => am.loadAll([image])),
        );
        const failure = loaded.find((result) => result.status === "rejected");
        if (failure) {
          await Promise.all([
            ...images.map((image, index) =>
              loaded[index]?.status === "fulfilled"
                ? am.unload(image)
                : undefined,
            ),
            ...externalTilesetPaths(map).map((source) => Assets.unload(source)),
            Assets.unload(path),
          ]);
          throw failure.reason;
        }
        return map;
      },
      unload: (path: string, map: TiledMapData) => {
        const images = tilesetImagePaths(map).map((image) =>
          am.unload(texture(image)),
        );
        // An external tileset's JSON is plain data: a map that inlined it
        // holds its own copy, so dropping the cache entry costs a second map
        // nothing but a re-fetch if it is loaded again.
        return Promise.all([
          ...images,
          ...externalTilesetPaths(map).map((source) => Assets.unload(source)),
          Assets.unload(path),
        ]).then(() => undefined);
      },
    };
    am.registerLoader("tiledMap", loader);
  }
}
