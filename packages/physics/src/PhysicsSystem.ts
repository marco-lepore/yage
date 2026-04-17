import {
  System,
  Phase,
  Transform,
  Vec2,
  SceneManagerKey,
} from "@yagejs/core";
import type { Scene, SceneManager } from "@yagejs/core";
import { PhysicsWorldManagerKey } from "./types.js";
import type { ScenePhysicsContext } from "./types.js";
// Systems keep `PhysicsWorldManagerKey` (engine scope) because each scene's
// `ScenePhysicsContext` carries the sub-accumulator + interpolation alpha,
// not just the world; the scene-scoped `PhysicsWorldKey` only resolves the
// `PhysicsWorld`. Components use the scoped key for ergonomic access.
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";

/**
 * Steps per-scene physics worlds and synchronises Rapier ↔ Transform.
 *
 * Runs in FixedUpdate at priority 0, before ComponentFixedUpdateSystem (priority 1000).
 *
 * Each active scene with physics gets its own sub-accumulator scaled by
 * `scene.timeScale`. Paused scenes are simply not stepped — no sleep/wake needed.
 */
export class PhysicsSystem extends System {
  readonly phase = Phase.FixedUpdate;
  readonly priority = 0;

  private manager!: PhysicsWorldManager;
  private sceneManager!: SceneManager;

  update(dt: number): void {
    if (!this.manager) {
      this.manager = this.use(PhysicsWorldManagerKey);
      this.sceneManager = this.use(SceneManagerKey);
    }

    for (const scene of this.sceneManager.activeScenes) {
      const ctx = this.manager.getContext(scene);
      if (!ctx) continue;

      this.stepScene(dt, scene, ctx);
    }
  }

  private stepScene(
    dt: number,
    scene: Scene,
    ctx: ScenePhysicsContext,
  ): void {
    const timeScale = scene.timeScale;
    const maxSteps = Math.min(Math.ceil(timeScale) + 1, 8);
    ctx.accumulator += dt * timeScale;

    // Cap accumulator to prevent unbounded growth at high timeScale
    ctx.accumulator = Math.min(ctx.accumulator, dt * maxSteps);

    let steps = 0;
    while (ctx.accumulator >= dt && steps < maxSteps) {
      this.preStep(scene, ctx.world);
      ctx.world.step(dt / 1000);
      this.postStep(scene, ctx.world);
      ctx.accumulator -= dt;
      steps++;
    }

    // Update per-scene interpolation alpha for smooth rendering
    ctx.alphaRef.value = Math.max(0, Math.min(1, ctx.accumulator / dt));

    // Process collision events once after all steps
    ctx.world.processCollisionEvents();
  }

  /** Pre-step: store prev state and sync kinematic bodies. */
  private preStep(scene: Scene, world: PhysicsWorld): void {
    for (const entity of scene.getEntities()) {
      if (entity.isDestroyed) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1) continue;

      const body = world.getBody(rb._bodyHandle);
      if (!body) continue;

      // Store previous state for interpolation
      rb._prevPosition = rb._currPosition;
      rb._prevRotation = rb._currRotation;

      // Sync Transform → Rapier for kinematic bodies
      if (body.isKinematic()) {
        const transform = entity.get(Transform);
        body.setNextKinematicTranslation({
          x: world.toMeters(transform.worldPosition.x),
          y: world.toMeters(transform.worldPosition.y),
        });
        body.setNextKinematicRotation(transform.worldRotation);
      }

      // Clear teleport flag
      if (rb._teleported) {
        rb._teleported = false;
      }
    }
  }

  /** Post-step: sync Rapier state back to transforms for dynamic bodies. */
  private postStep(scene: Scene, world: PhysicsWorld): void {
    for (const entity of scene.getEntities()) {
      if (entity.isDestroyed) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1) continue;

      const body = world.getBody(rb._bodyHandle);
      if (!body || !body.isDynamic()) continue;

      const translation = body.translation();
      const rotation = body.rotation();
      rb._currPosition = new Vec2(
        world.toPixels(translation.x),
        world.toPixels(translation.y),
      );
      rb._currRotation = rotation;

      // Update Transform — set world-space values
      const transform = entity.get(Transform);
      transform.worldPosition = rb._currPosition;
      if (rb.syncRotation) {
        transform.worldRotation = rb._currRotation;
      }
    }
  }
}
