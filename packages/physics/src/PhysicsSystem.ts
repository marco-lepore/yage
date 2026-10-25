import {
  MathUtils,
  System,
  Phase,
  Transform,
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
import { ColliderComponent } from "./ColliderComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";
import { pendingPhysicsTime, sceneTimeScale } from "./stepSchedule.js";

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
 * time scale 1 sees each step's transitions in order, with dynamic bodies'
 * Transforms synced to the step that produced them, and a handler's
 * `setVelocity` or `destroy` takes effect before the next step of the same
 * tick.
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
    ctx.accumulator = pendingPhysicsTime(
      ctx.accumulator,
      dt,
      sceneTimeScale(scene),
    );

    let steps = 0;
    while (ctx.accumulator >= dt) {
      // The step's share of the scene time this world still has to simulate.
      this.preStep(scene, ctx.world, dt / ctx.accumulator);
      ctx.world.step(dt);
      this.postStep(scene, ctx.world);
      ctx.world.processCollisionEvents();
      ctx.accumulator -= dt;
      steps++;
    }
    // An update that runs no step still hands kinematic targets back to the
    // Transform, so code that adds to it each update builds on its last write.
    if (steps === 0) this.restoreKinematicTargets(scene, ctx.world);
  }

  /**
   * Pre-step: sync collider scales and drive kinematic bodies toward their
   * target. `share` is this step's part of the scene time not yet simulated,
   * at most 1.
   */
  private preStep(scene: Scene, world: PhysicsWorld, share: number): void {
    for (const entity of scene.getEntities()) {
      if (!entity.isActive) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1) continue;

      entity.tryGet(ColliderComponent)?._syncScale();

      const body = world.getBody(rb._bodyHandle);
      if (!body) continue;

      // Kinematic bodies move toward the captured target, not toward the
      // Transform itself — the Transform usually holds the interpolated
      // (trailing) pose at this point in the frame. The capture here keeps
      // the target fresh on catch-up frames that run several fixed updates
      // between interpolation passes; without it, the later updates would
      // keep driving toward an older target and the pending write would
      // land later as one doubled move.
      //
      // Each step covers its share of the scene time still to simulate, so
      // the body moves at a steady speed at any time scale. When the scene
      // time does not divide into whole steps, the body ends the update short
      // of the target and continues toward it in the next one.
      if (body.isKinematic()) {
        rb._capturePendingTarget();
        const x = world.toMeters(rb._kinematicTargetPositionX);
        const y = world.toMeters(rb._kinematicTargetPositionY);
        const rotation = rb._kinematicTargetRotation;
        if (share >= 1) {
          body.setNextKinematicTranslation({ x, y });
          body.setNextKinematicRotation(rotation);
        } else {
          const at = body.translation();
          body.setNextKinematicTranslation({
            x: at.x + (x - at.x) * share,
            y: at.y + (y - at.y) * share,
          });
          body.setNextKinematicRotation(
            MathUtils.lerpAngle(body.rotation(), rotation, share),
          );
        }
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
      // Both poses describe the last completed step until the next one ends:
      // contact filters read kinematic velocity from their difference.
      rb._prevPositionX = rb._currPositionX;
      rb._prevPositionY = rb._currPositionY;
      rb._prevRotation = rb._currRotation;
      rb._currPositionX = world.toPixels(translation.x);
      rb._currPositionY = world.toPixels(translation.y);
      rb._currRotation = body.rotation();

      const transform = entity.get(Transform);
      if (isDynamic) {
        // Update Transform — set world-space values
        transform.setWorldPosition(rb._currPositionX, rb._currPositionY);
        if (rb.syncRotation) {
          transform.worldRotation = rb._currRotation;
        }
      } else {
        this.restoreKinematicTarget(rb, transform);
      }
    }
  }

  /** Hand every kinematic body's target back to its Transform, for an update with no step. */
  private restoreKinematicTargets(scene: Scene, world: PhysicsWorld): void {
    for (const entity of scene.getEntities()) {
      if (!entity.isActive) continue;
      const rb = entity.tryGet(RigidBodyComponent);
      if (!rb || rb._bodyHandle === -1) continue;
      if (!world.getBody(rb._bodyHandle)?.isKinematic()) continue;
      this.restoreKinematicTarget(rb, entity.get(Transform));
    }
  }

  /**
   * Put a kinematic body's target back into its Transform so a fixedUpdate
   * author that accumulates (`transform.translate(...)`) builds on its own
   * last write. The body itself can end an update short of the target, and
   * the last lerp left an interpolated pose. A Transform the game has written
   * since that lerp is a target the capture in PhysicsInterpolationSystem
   * hasn't consumed yet — leave it alone. The last-written pose moves with
   * the restore so the restored value doesn't itself read as a pending game
   * write.
   */
  private restoreKinematicTarget(
    rb: RigidBodyComponent,
    transform: Transform,
  ): void {
    if (!rb._hasPendingTargetPosition()) {
      transform.setWorldPosition(
        rb._kinematicTargetPositionX,
        rb._kinematicTargetPositionY,
      );
      rb._lastWrittenPositionX = rb._kinematicTargetPositionX;
      rb._lastWrittenPositionY = rb._kinematicTargetPositionY;
    }
    if (rb.syncRotation && !rb._hasPendingTargetRotation()) {
      transform.worldRotation = rb._kinematicTargetRotation;
      rb._lastWrittenRotation = rb._kinematicTargetRotation;
    }
  }
}
