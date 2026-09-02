import {
  System,
  Phase,
  Transform,
  Vec2,
  SceneManagerKey,
  SceneTimeKey,
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
 * Each active scene with physics gets its own sub-accumulator scaled by the
 * scene's effective time scale (`SceneTime.effectiveScale` — the persistent
 * `scene.timeScale` composed with active freeze/slow-mo requests). Paused
 * scenes are simply not stepped — no sleep/wake needed.
 *
 * Collision events are delivered after every step, so a scene running above
 * time scale 1 sees each step's transitions in order, with Transforms synced
 * to the step that produced them, and a handler's `setVelocity` or `destroy`
 * takes effect before the next step of the same tick.
 *
 * NOTE: `entity.timeScale` and SceneTime `excludeUpdates` exclusions are
 * intentionally NOT applied here. The whole scene shares one Rapier world
 * stepped once per (scaled) fixed tick, so there is no per-body notion of
 * time — a single entity cannot be individually slowed or sped up. They only
 * affect component `update`/`fixedUpdate`, the entity's `ProcessComponent`,
 * and its particle emitters. For per-body time control, use a kinematic body
 * or scale velocities manually.
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

  private stepScene(dt: number, scene: Scene, ctx: ScenePhysicsContext): void {
    const timeScale =
      scene.tryResolveScoped(SceneTimeKey)?.effectiveScale ?? scene.timeScale;
    const maxSteps = Math.min(Math.ceil(timeScale) + 1, 8);
    ctx.accumulator += dt * timeScale;

    // Cap accumulator to prevent unbounded growth at high timeScale
    ctx.accumulator = Math.min(ctx.accumulator, dt * maxSteps);

    let steps = 0;
    while (ctx.accumulator >= dt && steps < maxSteps) {
      this.preStep(scene, ctx.world);
      ctx.world.step(dt);
      this.postStep(scene, ctx.world);
      ctx.world.processCollisionEvents();
      ctx.accumulator -= dt;
      steps++;
    }
  }

  /** Pre-step: store prev state and drive kinematic bodies to their target. */
  private preStep(scene: Scene, world: PhysicsWorld): void {
    for (const entity of scene.getEntities()) {
      if (!entity.isActive) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1) continue;

      const body = world.getBody(rb._bodyHandle);
      if (!body) continue;

      // Store previous state for interpolation
      rb._prevPosition = rb._currPosition;
      rb._prevRotation = rb._currRotation;

      // Kinematic bodies move toward the captured target, not toward the
      // Transform itself — the Transform usually holds the interpolated
      // (trailing) pose at this point in the frame. The capture here keeps
      // the target fresh on catch-up frames that run several steps between
      // interpolation passes; without it, later steps in the same frame
      // would re-drive an already-reached target and the pending write
      // would land as one doubled step.
      if (body.isKinematic()) {
        rb._capturePendingTarget();
        body.setNextKinematicTranslation({
          x: world.toMeters(rb._kinematicTargetPosition.x),
          y: world.toMeters(rb._kinematicTargetPosition.y),
        });
        body.setNextKinematicRotation(rb._kinematicTargetRotation);
      }
    }
  }

  /** Post-step: sync Rapier state back for dynamic and kinematic bodies. */
  private postStep(scene: Scene, world: PhysicsWorld): void {
    for (const entity of scene.getEntities()) {
      if (!entity.isActive) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1) continue;

      const body = world.getBody(rb._bodyHandle);
      if (!body) continue;
      const isDynamic = body.isDynamic();
      if (!isDynamic && !body.isKinematic()) continue;

      const translation = body.translation();
      rb._currPosition = new Vec2(
        world.toPixels(translation.x),
        world.toPixels(translation.y),
      );
      rb._currRotation = body.rotation();

      const transform = entity.get(Transform);
      if (isDynamic) {
        // Update Transform — set world-space values
        transform.worldPosition = rb._currPosition;
        if (rb.syncRotation) {
          transform.worldRotation = rb._currRotation;
        }
      } else {
        // Kinematic: the body reached its target this step. Put that pose
        // back into the Transform so a fixedUpdate author that accumulates
        // (`transform.translate(...)`) builds on its own last write rather
        // than on the interpolated pose the last lerp left behind. A
        // Transform the game has written since that lerp is a target the
        // capture in PhysicsInterpolationSystem hasn't consumed yet — leave
        // it alone. The last-written pose moves with the restore so the
        // restored value doesn't itself read as a pending game write.
        if (!rb._hasPendingTargetPosition()) {
          transform.worldPosition = rb._currPosition;
          rb._lastWrittenPosition = rb._currPosition;
        }
        if (rb.syncRotation && !rb._hasPendingTargetRotation()) {
          transform.worldRotation = rb._currRotation;
          rb._lastWrittenRotation = rb._currRotation;
        }
      }
    }
  }
}
