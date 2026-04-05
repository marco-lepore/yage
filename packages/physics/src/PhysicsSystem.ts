import {
  System,
  Phase,
  Transform,
  Vec2,
  SceneManagerKey,
} from "@yage/core";
import type { SceneManager } from "@yage/core";
import { PhysicsWorldKey, PhysicsInterpolationAlphaKey } from "./types.js";
import type { PhysicsAlphaRef } from "./types.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";

/**
 * Steps the physics world and synchronises Rapier ↔ Transform.
 *
 * Runs in FixedUpdate at priority 0, before ComponentFixedUpdateSystem (priority 1000).
 *
 * Features:
 * - Iterates all non-paused scenes (not just the top)
 * - Sleeps/wakes Rapier bodies when scenes pause/resume
 * - Uses a sub-accumulator scaled by scene.timeScale to control step frequency
 */
export class PhysicsSystem extends System {
  readonly phase = Phase.FixedUpdate;
  readonly priority = 0;

  private physicsWorld!: PhysicsWorld;
  private sceneManager!: SceneManager;
  private alphaRef!: PhysicsAlphaRef;
  private physicsAccumulator = 0;
  private warnedMultiSceneTimeScale = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(dt: number): void {
    // Lazy resolve services on first call (using cached `use()`)
    if (!this.physicsWorld) {
      this.physicsWorld = this.use(PhysicsWorldKey);
      this.sceneManager = this.use(SceneManagerKey);
      this.alphaRef = this.use(PhysicsInterpolationAlphaKey);
    }

    // --- Pause handling: sleep/wake bodies based on scene pause state ---
    for (const scene of this.sceneManager.all) {
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        const rb = entity.tryGet(RigidBodyComponent);
        if (!rb || rb._bodyHandle === -1) continue;

        const body = this.physicsWorld.getBody(rb._bodyHandle);
        if (!body) continue;

        if (scene.isPaused) {
          if (!rb._pauseSleeping) {
            body.sleep();
            rb._pauseSleeping = true;
          }
        } else if (rb._pauseSleeping) {
          body.wakeUp();
          rb._pauseSleeping = false;
        }
      }
    }

    // --- Nothing to simulate when all scenes are paused ---
    if (this.sceneManager.activeScenes.length === 0) return;

    // --- Sub-accumulator: scale step count by scene timeScale ---
    const timeScale = this.getActivePhysicsTimeScale();
    const maxSteps = Math.min(Math.ceil(timeScale) + 1, 8);
    this.physicsAccumulator += dt * timeScale;

    // Cap accumulator to prevent unbounded growth at high timeScale
    this.physicsAccumulator = Math.min(this.physicsAccumulator, dt * maxSteps);

    let steps = 0;
    while (this.physicsAccumulator >= dt && steps < maxSteps) {
      this.preStep();
      this.physicsWorld.step(dt / 1000);
      this.postStep();
      this.physicsAccumulator -= dt;
      steps++;
    }

    // Update interpolation alpha for smooth rendering
    this.alphaRef.value = Math.max(0, Math.min(1, this.physicsAccumulator / dt));

    // Process collision events once after all steps
    this.physicsWorld.processCollisionEvents();
  }

  /** Pre-step: store prev state and sync kinematic bodies for active scenes. */
  private preStep(): void {
    for (const scene of this.sceneManager.activeScenes) {
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        const rb = entity.tryGet(RigidBodyComponent);
        if (!rb || rb._bodyHandle === -1) continue;

        const body = this.physicsWorld.getBody(rb._bodyHandle);
        if (!body) continue;

        // Store previous state for interpolation
        rb._prevPosition = rb._currPosition;
        rb._prevRotation = rb._currRotation;

        // Sync Transform → Rapier for kinematic bodies
        if (body.isKinematic()) {
          const transform = entity.get(Transform);
          body.setNextKinematicTranslation({
            x: this.physicsWorld.toMeters(transform.worldPosition.x),
            y: this.physicsWorld.toMeters(transform.worldPosition.y),
          });
          body.setNextKinematicRotation(transform.worldRotation);
        }

        // Clear teleport flag
        if (rb._teleported) {
          rb._teleported = false;
        }
      }
    }
  }

  /** Post-step: sync Rapier state back to transforms for dynamic bodies in active scenes. */
  private postStep(): void {
    for (const scene of this.sceneManager.activeScenes) {
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        const rb = entity.tryGet(RigidBodyComponent);
        if (!rb || rb._bodyHandle === -1) continue;

        const body = this.physicsWorld.getBody(rb._bodyHandle);
        if (!body || !body.isDynamic()) continue;

        const translation = body.translation();
        const rotation = body.rotation();
        rb._currPosition = new Vec2(
          this.physicsWorld.toPixels(translation.x),
          this.physicsWorld.toPixels(translation.y),
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

  /**
   * Get the timeScale from the first active scene.
   *
   * Limitation: there is one shared Rapier world and one sub-accumulator,
   * so all physics bodies step at the same rate. If multiple active scenes
   * have different timeScales, only the first scene's value is used.
   */
  private getActivePhysicsTimeScale(): number {
    let first: number | undefined;
    for (const scene of this.sceneManager.activeScenes) {
      if (first === undefined) {
        first = scene.timeScale;
      } else if (scene.timeScale !== first && !this.warnedMultiSceneTimeScale) {
        this.warnedMultiSceneTimeScale = true;
        console.warn(
          `[PhysicsSystem] Multiple active scenes with different timeScales ` +
            `(${first} vs ${scene.timeScale}). All physics bodies share one ` +
            `Rapier world and will step at the first scene's timeScale.`,
        );
        break;
      }
    }
    return first ?? 1;
  }
}
