import {
  System,
  Phase,
  Transform,
  SceneManagerKey,
} from "@yage/core";
import type { SceneManager } from "@yage/core";
import { PhysicsInterpolationAlphaKey } from "./types.js";
import type { PhysicsAlphaRef } from "./types.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";

/**
 * Blends previous and current physics positions for smooth rendering.
 *
 * Runs in LateUpdate (after Update, before Render) at priority 100.
 * Only interpolates dynamic bodies — kinematic and static are user-controlled.
 *
 * Uses the physics-specific interpolation alpha from PhysicsSystem's sub-accumulator,
 * so interpolation stays correct even when scene timeScale changes the physics step rate.
 */
export class PhysicsInterpolationSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 100;

  private sceneManager!: SceneManager;
  private alphaRef!: PhysicsAlphaRef;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_dt: number): void {
    if (!this.sceneManager) {
      this.sceneManager = this.use(SceneManagerKey);
      this.alphaRef = this.use(PhysicsInterpolationAlphaKey);
    }

    const alpha = this.alphaRef.value;

    for (const scene of this.sceneManager.activeScenes) {
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        const rb = entity.tryGet(RigidBodyComponent);
        if (!rb || rb._bodyHandle === -1 || rb.type !== "dynamic") continue;

        const transform = entity.get(Transform);
        transform.worldPosition = rb._prevPosition.lerp(
          rb._currPosition,
          alpha,
        );
        if (rb.syncRotation) {
          transform.worldRotation =
            rb._prevRotation + (rb._currRotation - rb._prevRotation) * alpha;
        }
      }
    }
  }
}
