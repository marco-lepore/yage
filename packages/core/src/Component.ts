import type { EngineContext } from "./EngineContext.js";

/**
 * Base class for all components.
 *
 * Components are the primary authoring model. Game developers write behavior
 * in components using optional `update(dt)` and `fixedUpdate(dt)` methods.
 * The built-in ComponentUpdateSystem calls these methods automatically.
 */
export abstract class Component {
  /**
   * Back-reference to the owning entity. Set by the engine when the component
   * is added to an entity. Do not set manually.
   */
  entity!: import("./Entity.js").Entity;

  /** Whether this component is active. Disabled components are skipped by ComponentUpdateSystem. */
  enabled = true;

  /**
   * Access the EngineContext from the entity's scene.
   * Throws if the entity is not in a scene.
   */
  get context(): EngineContext {
    const scene = this.entity.scene;
    if (!scene) {
      throw new Error(
        "Cannot access context: entity is not attached to a scene.",
      );
    }
    return scene.context;
  }

  /** Called when the component is added to an entity. */
  onAdd?(): void;

  /** Called when the component is removed from an entity. */
  onRemove?(): void;

  /** Called when the component is destroyed (entity destroyed or component removed). */
  onDestroy?(): void;

  /** Called every frame by the built-in ComponentUpdateSystem. */
  update?(dt: number): void;

  /** Called every fixed timestep by the built-in ComponentUpdateSystem. */
  fixedUpdate?(dt: number): void;
}
