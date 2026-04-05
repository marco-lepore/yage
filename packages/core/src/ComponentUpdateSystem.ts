import { System } from "./System.js";
import { Phase } from "./types.js";
import type { EngineContext } from "./EngineContext.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { SceneManager } from "./SceneManager.js";
import { SceneManagerKey, ErrorBoundaryKey } from "./EngineContext.js";

/**
 * Built-in system that bridges the OOP and ECS worlds.
 *
 * Iterates all entities in non-paused scenes and calls component
 * `update(dt)` or `fixedUpdate(dt)` methods on enabled components.
 *
 * This system runs at two phases:
 * - Phase.FixedUpdate for fixedUpdate(dt)
 * - Phase.Update for update(dt)
 *
 * We actually register two separate instances — one per phase — since
 * a System can only belong to one phase.
 */
abstract class BaseComponentUpdateSystem extends System {
  /** High priority so game logic runs after engine systems like physics. */
  override readonly priority = 1000;

  protected sceneManager!: SceneManager;
  protected errorBoundary!: ErrorBoundary;

  override onRegister(context: EngineContext): void {
    this.sceneManager = context.resolve(SceneManagerKey);
    this.errorBoundary = context.resolve(ErrorBoundaryKey);
  }
}

/** Calls `fixedUpdate(dt)` on all enabled components in non-paused scenes. */
export class ComponentFixedUpdateSystem extends BaseComponentUpdateSystem {
  override readonly phase = Phase.FixedUpdate;

  update(dt: number): void {
    for (const scene of this.sceneManager.activeScenes) {
      const sceneDt = dt * scene.timeScale;
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        for (const component of entity.getAll()) {
          if (!component.enabled || !component.fixedUpdate) continue;
          const fixedUpdate = component.fixedUpdate;
          this.errorBoundary.wrapComponent(component, () =>
            fixedUpdate.call(component, sceneDt),
          );
        }
      }
    }
  }
}

/** Calls `update(dt)` on all enabled components in non-paused scenes. */
export class ComponentUpdateSystem extends BaseComponentUpdateSystem {
  override readonly phase = Phase.Update;

  update(dt: number): void {
    for (const scene of this.sceneManager.activeScenes) {
      const sceneDt = dt * scene.timeScale;
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        for (const component of entity.getAll()) {
          if (!component.enabled || !component.update) continue;
          const update = component.update;
          this.errorBoundary.wrapComponent(component, () =>
            update.call(component, sceneDt),
          );
        }
      }
    }
  }
}
