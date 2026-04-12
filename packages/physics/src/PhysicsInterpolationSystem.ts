import {
  System,
  Phase,
  Transform,
} from "@yagejs/core";
import { PhysicsWorldManagerKey } from "./types.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";

/**
 * Blends previous and current physics positions for smooth rendering.
 *
 * Runs in LateUpdate (after Update, before Render) at priority 100.
 * Only interpolates dynamic bodies — kinematic and static are user-controlled.
 *
 * Iterates **all** scenes with physics contexts (including paused ones) so that
 * a mid-frame pause doesn't cause a visual pop. Paused scenes keep their frozen
 * alpha, so the lerp writes the same value each frame until resumed.
 */
export class PhysicsInterpolationSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 100;

  private manager!: PhysicsWorldManager;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_dt: number): void {
    if (!this.manager) {
      this.manager = this.use(PhysicsWorldManagerKey);
    }

    for (const [scene, ctx] of this.manager.getAllContexts()) {
      const alpha = ctx.alphaRef.value;

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
