import {
  System,
  Phase,
  Transform,
  GameLoopKey,
  SceneTimeKey,
} from "@yagejs/core";
import type { GameLoop } from "@yagejs/core";
import { PhysicsWorldManagerKey } from "./types.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";

/**
 * Computes each scene's interpolation alpha, then blends previous and current
 * physics poses into Transform for smooth rendering.
 *
 * Runs in Update at priority -100 — ahead of particles (0), processes (500)
 * and component updates (1000) — so game logic reads the same pose that is
 * drawn this frame. Only dynamic bodies are interpolated; kinematic and static
 * bodies are user-controlled.
 *
 * Alpha combines the scene's own sub-accumulator, holding scene time no step
 * has simulated yet, with the game loop's leftover frame time converted to
 * scene time. It is clamped to 1: after a stall the loop caps its fixed steps
 * per frame, so its accumulator can hold more than one timestep.
 *
 * Iterates **all** scenes with physics contexts, including paused ones, so
 * that a mid-frame pause doesn't cause a visual pop. A paused scene — and a
 * scene whose effective time scale is 0, such as during a freeze — skips the
 * alpha recompute and keeps its frozen value, so the lerp writes the same
 * pose each frame until the scene resumes.
 */
export class PhysicsInterpolationSystem extends System {
  readonly phase = Phase.Update;
  readonly priority = -100;

  private manager!: PhysicsWorldManager;
  private loop!: GameLoop;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_dt: number): void {
    if (!this.manager) {
      this.manager = this.use(PhysicsWorldManagerKey);
      this.loop = this.use(GameLoopKey);
    }

    for (const [scene, ctx] of this.manager.getAllContexts()) {
      const timeScale =
        scene.tryResolveScoped(SceneTimeKey)?.effectiveScale ??
        scene.timeScale;
      if (!scene.isPaused && timeScale > 0) {
        ctx.alphaRef.value = Math.min(
          1,
          ctx.accumulator / this.loop.fixedTimestep +
            this.loop.interpolationAlpha * timeScale,
        );
      }

      const alpha = ctx.alphaRef.value;

      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed || !entity.isActive) continue;
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
