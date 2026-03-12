import {
  System,
  Phase,
  Transform,
  GameLoopKey,
  SceneManagerKey,
} from "@yage/core";
import type { GameLoop, SceneManager } from "@yage/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";

/**
 * Blends previous and current physics positions for smooth rendering.
 *
 * Runs in LateUpdate (after Update, before Render) at priority 100.
 * Only interpolates dynamic bodies — kinematic and static are user-controlled.
 */
export class PhysicsInterpolationSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 100;

  private gameLoop!: GameLoop;
  private sceneManager!: SceneManager;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_dt: number): void {
    if (!this.gameLoop) {
      this.gameLoop = this.use(GameLoopKey);
      this.sceneManager = this.use(SceneManagerKey);
    }

    const scene = this.sceneManager.active;
    if (!scene) return;

    const alpha = this.gameLoop.interpolationAlpha;

    for (const entity of scene.getEntities()) {
      if (entity.isDestroyed) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1 || rb.type !== "dynamic") continue;

      const transform = entity.get(Transform);
      transform.position = rb._prevPosition.lerp(rb._currPosition, alpha);
      if (rb.syncRotation) {
        transform.rotation =
          rb._prevRotation + (rb._currRotation - rb._prevRotation) * alpha;
      }
    }
  }
}
