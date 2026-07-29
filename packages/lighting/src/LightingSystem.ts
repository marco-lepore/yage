import { Phase, QueryCacheKey, System } from "@yagejs/core";
import type { EngineContext, QueryResult, Scene } from "@yagejs/core";
import { CameraComponent, RendererKey } from "@yagejs/renderer";
import type { RendererPlugin } from "@yagejs/renderer";
import type { LightingWorldManager } from "./LightingWorldManager.js";
import { LightingWorldManagerKey } from "./types.js";

/** Synchronizes every scene's lighting backend after camera transforms update. */
export class LightingSystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 100;

  private cameraQuery!: QueryResult;
  private manager!: LightingWorldManager;
  private renderer!: RendererPlugin;

  onRegister(context: EngineContext): void {
    this.cameraQuery = context
      .resolve(QueryCacheKey)
      .register([CameraComponent]);
    this.manager = context.resolve(LightingWorldManagerKey);
    this.renderer = context.resolve(RendererKey);
  }

  update(): void {
    const cameras = new Map<Scene, CameraComponent>();
    for (const entity of this.cameraQuery) {
      const scene = entity.tryScene;
      if (!scene) continue;
      const camera = entity.get(CameraComponent);
      if (!camera.effectiveEnabled) continue;
      const current = cameras.get(scene);
      if (!current || camera.priority >= current.priority) {
        cameras.set(scene, camera);
      }
    }

    const viewport = this.renderer.virtualSize;
    for (const [scene, world] of this.manager.getAllWorlds()) {
      world._render({
        camera: cameras.get(scene) ?? null,
        width: viewport.width,
        height: viewport.height,
      });
    }
  }
}
