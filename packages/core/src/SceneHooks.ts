import type { Scene } from "./Scene.js";
import { ServiceKey, LoggerKey } from "./EngineContext.js";
import type { Logger } from "./Logger.js";

/**
 * Plugin hooks invoked by the SceneManager at scene lifecycle points.
 * Plugins register hooks via `engine.registerSceneHooks(hooks)` to set up or
 * tear down per-scene state (e.g. render containers, physics worlds).
 */
export interface SceneHooks {
  /**
   * Runs after the scene's context is bound but before preload / `onEnter`.
   * Awaited serially so scoped services registered here are ready when the
   * scene's own code runs. Fires on `push`, `replace`, and `_mountDetached`.
   */
  beforeEnter?(scene: Scene): void | Promise<void>;

  /**
   * Runs after `onExit` + `_destroyAllEntities` and before the scene's
   * scoped-service map is cleared. Fires on `pop`, `replace`, `clear`, and
   * `_unmountDetached`.
   */
  afterExit?(scene: Scene): void;
}

/**
 * Registry of scene hooks. Held by the engine, consumed by the SceneManager.
 * @internal
 */
export class SceneHookRegistry {
  private readonly hooks: SceneHooks[] = [];

  register(hooks: SceneHooks): () => void {
    this.hooks.push(hooks);
    return () => {
      const idx = this.hooks.indexOf(hooks);
      if (idx !== -1) this.hooks.splice(idx, 1);
    };
  }

  /** Run all `beforeEnter` hooks serially. */
  async runBeforeEnter(scene: Scene): Promise<void> {
    for (const h of this.hooks) {
      await h.beforeEnter?.(scene);
    }
  }

  runAfterExit(scene: Scene): void {
    for (const h of this.hooks) {
      try {
        h.afterExit?.(scene);
      } catch (err) {
        // Swallow so one failing plugin doesn't block teardown of the rest.
        const logger = scene.context.tryResolve(LoggerKey) as
          | Logger
          | undefined;
        if (logger) {
          logger.error("core", "Scene afterExit hook threw", {
            scene: scene.name,
            error: err,
          });
        } else {
          console.error(
            `[yage] Scene afterExit hook threw for scene "${scene.name}":`,
            err,
          );
        }
      }
    }
  }
}

/** DI key for the scene-hook registry. @internal */
export const SceneHookRegistryKey = new ServiceKey<SceneHookRegistry>(
  "sceneHookRegistry",
);
