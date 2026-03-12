import {
  System,
  Phase,
  Transform,
  Vec2,
  SceneManagerKey,
} from "@yage/core";
import type { SceneManager } from "@yage/core";
import { PhysicsWorldKey } from "./types.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";

/**
 * Steps the physics world and synchronises Rapier ↔ Transform.
 *
 * Runs in FixedUpdate at priority 0, before ComponentFixedUpdateSystem (priority 1000).
 */
export class PhysicsSystem extends System {
  readonly phase = Phase.FixedUpdate;
  readonly priority = 0;

  private physicsWorld!: PhysicsWorld;
  private sceneManager!: SceneManager;

  update(dt: number): void {
    // Lazy resolve services on first call (using cached `use()`)
    if (!this.physicsWorld) {
      this.physicsWorld = this.use(PhysicsWorldKey);
      this.sceneManager = this.use(SceneManagerKey);
    }

    const scene = this.sceneManager.active;
    if (!scene) return;

    // Iterate entities with RigidBodyComponent
    for (const entity of scene.getEntities()) {
      if (entity.isDestroyed) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1) continue;

      const body = this.physicsWorld.getBody(rb._bodyHandle);
      if (!body) continue;

      // 1. Store previous state for interpolation
      rb._prevPosition = rb._currPosition;
      rb._prevRotation = rb._currRotation;

      // 2. Sync Transform → Rapier for kinematic bodies
      if (body.isKinematic()) {
        const transform = entity.get(Transform);
        body.setNextKinematicTranslation({
          x: this.physicsWorld.toMeters(transform.position.x),
          y: this.physicsWorld.toMeters(transform.position.y),
        });
        body.setNextKinematicRotation(transform.rotation);
      }

      // 3. Clear teleport flag (already snapped prev=curr in setPosition)
      if (rb._teleported) {
        rb._teleported = false;
      }
    }

    // 4. Step the physics world (dt is in ms, convert to seconds)
    this.physicsWorld.step(dt / 1000);

    // 5. Sync Rapier → curr state + Transform for dynamic bodies
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

      // Update Transform (interpolation will override in LateUpdate)
      const transform = entity.get(Transform);
      transform.position = rb._currPosition;
      if (rb.syncRotation) {
        transform.rotation = rb._currRotation;
      }
    }

    // 6. Process collision events
    this.physicsWorld.processCollisionEvents();
  }
}
