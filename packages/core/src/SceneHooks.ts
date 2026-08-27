import type { Scene } from "./Scene.js";
import { ServiceKey } from "./EngineContext.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import { isThenable } from "./internal/thenable.js";

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
  private errorBoundary: ErrorBoundary | undefined;

  /**
   * Wire the error boundary. Called once from `Engine`'s constructor, since
   * this registry is constructed directly rather than resolved through
   * `EngineContext`.
   * @internal
   */
  _setErrorBoundary(boundary: ErrorBoundary): void {
    this.errorBoundary = boundary;
  }

  register(hooks: SceneHooks): () => void {
    this.hooks.push(hooks);
    return () => {
      const idx = this.hooks.indexOf(hooks);
      if (idx !== -1) this.hooks.splice(idx, 1);
    };
  }

  /**
   * Run all `beforeEnter` hooks serially. A throwing hook is reported
   * through the error boundary and rethrown, stopping later hooks —
   * propagation to the caller (`SceneManager`) is unchanged.
   */
  async runBeforeEnter(scene: Scene): Promise<void> {
    for (const h of this.hooks) {
      try {
        await h.beforeEnter?.(scene);
      } catch (err) {
        this.errorBoundary?.reportLifecycleError(err, {
          kind: "Scene beforeEnter hook",
          scene: scene.name,
        });
        throw err;
      }
    }
  }

  /**
   * Run all `afterExit` hooks. A throwing hook is reported through the error
   * boundary — recorded in `Inspector.getErrors().callbackErrors` and logged —
   * and not rethrown, so one failing plugin doesn't block teardown of the rest.
   * `afterExit` is typed void-returning but an `async` one compiles against
   * that signature; its rejection is reported the same way, after the
   * remaining hooks have already run.
   */
  runAfterExit(scene: Scene): void {
    for (const h of this.hooks) {
      const info = { kind: "Scene afterExit hook", scene: scene.name };
      try {
        const result = h.afterExit?.(scene) as unknown;
        if (isThenable(result)) {
          result.then(undefined, (err: unknown) =>
            this.errorBoundary?.reportLifecycleError(err, info),
          );
        }
      } catch (err) {
        this.errorBoundary?.reportLifecycleError(err, info);
      }
    }
  }
}

/** DI key for the scene-hook registry. @internal */
export const SceneHookRegistryKey = new ServiceKey<SceneHookRegistry>(
  "sceneHookRegistry",
);
