import type { Scene } from "@yagejs/core";
import { PhysicsWorld } from "./PhysicsWorld.js";
import type { PhysicsConfig, ScenePhysicsContext } from "./types.js";

/**
 * Manages per-scene Rapier physics worlds.
 *
 * Each scene that contains physics entities gets its own `PhysicsWorld`,
 * sub-accumulator, and interpolation alpha. Worlds are created lazily
 * (on the first physics entity added to a scene) and destroyed when the
 * scene exits.
 */
export class PhysicsWorldManager {
  private readonly contexts = new Map<Scene, ScenePhysicsContext>();
  private readonly config: PhysicsConfig | undefined;

  constructor(config?: PhysicsConfig) {
    this.config = config;
  }

  /**
   * Get (or lazily create) the physics world for a scene.
   * Call this from component `onAdd()` to ensure the world exists.
   */
  getOrCreateWorld(scene: Scene): PhysicsWorld {
    let ctx = this.contexts.get(scene);
    if (!ctx) {
      ctx = {
        world: new PhysicsWorld(this.config),
        accumulator: 0,
        alphaRef: { value: 0 },
      };
      this.contexts.set(scene, ctx);
    }
    return ctx.world;
  }

  /** Get the context for a scene, or undefined if none exists. */
  getContext(scene: Scene): ScenePhysicsContext | undefined {
    return this.contexts.get(scene);
  }

  /** Destroy a scene's physics world and remove it from the manager. */
  destroyWorld(scene: Scene): void {
    const ctx = this.contexts.get(scene);
    if (ctx) {
      ctx.world.destroy();
      this.contexts.delete(scene);
    }
  }

  /** Iterate all scene→context entries. */
  getAllContexts(): IterableIterator<[Scene, ScenePhysicsContext]> {
    return this.contexts.entries();
  }

  /** Destroy all physics worlds and clear state. */
  destroy(): void {
    for (const ctx of this.contexts.values()) {
      ctx.world.destroy();
    }
    this.contexts.clear();
  }
}
