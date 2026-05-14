import { AssetManagerKey } from "@yagejs/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { extensions, Assets } from "pixi.js";
import { tiledMapAssetExtension } from "./tiled/tiledMapLoader.js";
import { TilemapRenderSystem } from "./TilemapRenderSystem.js";
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

    // Register "tiledMap" loader with AssetManager
    const am = context.tryResolve(AssetManagerKey);
    am?.registerLoader("tiledMap", {
      load: (path: string) => Assets.load<TiledMapData>(path),
      unload: (path: string) => {
        Assets.unload(path);
      },
    });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new TilemapRenderSystem());
  }
}
