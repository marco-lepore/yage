import { AssetManagerKey } from "@yage/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yage/core";
import { extensions, Assets } from "pixi.js";
import { tiledMapAssetExtension } from "./tiled/tiledMapLoader.js";
import { TilemapRenderSystem } from "./TilemapRenderSystem.js";
import type { TiledMapData } from "./tiled/types.js";

/** Plugin that adds Tiled map loading and rendering to YAGE. */
export class TilemapPlugin implements Plugin {
  readonly name = "tilemap";
  readonly version = "2.0.0";
  readonly dependencies = ["renderer"] as const;

  install(context: EngineContext): void {
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
