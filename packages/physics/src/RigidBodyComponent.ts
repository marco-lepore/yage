import RAPIER from "@dimforge/rapier2d";
import {
  Component,
  MathUtils,
  Transform,
  Vec2,
  Vec2Buffer,
} from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PhysicsWorldKey } from "./types.js";
import type { BodyType, RigidBodyConfig } from "./types.js";
import { assertFiniteNumber, assertRequiredFinite } from "./validate.js";

/**
 * Tolerance for deciding whether the game wrote a Transform since physics
 * last did. Well above the float noise a world↔local round-trip through a
 * parent chain produces, well below any perceptible motion.
 */
const POSE_EPSILON = 1e-6;

function rapierBodyType(type: BodyType): RAPIER.RigidBodyType {
  switch (type) {
    case "dynamic":
      return RAPIER.RigidBodyType.Dynamic;
    case "static":
      return RAPIER.RigidBodyType.Fixed;
    case "kinematic":
      return RAPIER.RigidBodyType.KinematicPositionBased;
  }
}

/**
 * Wraps a Rapier rigid body. All public API values are in pixels.
 *
 * Component ordering: Transform must be added before RigidBodyComponent.
 */
export class RigidBodyComponent extends Component {
  /** Body type (dynamic, static, kinematic). `setType` changes it. */
  get type(): BodyType {
    return this._type;
  }

  /** If false, physics will not write rotation back to Transform. */
  syncRotation: boolean;

  /** @internal Rapier body handle, set during onAdd. */
  _bodyHandle = -1;

  /** @internal Previous position for interpolation. */
  _prevPositionX = 0;
  /** @internal */
  _prevPositionY = 0;
  /** @internal Previous rotation for interpolation. */
  _prevRotation = 0;
  /** @internal Current authoritative position (post physics step). */
  _currPositionX = 0;
  /** @internal */
  _currPositionY = 0;
  /** @internal Current authoritative rotation (post physics step). */
  _currRotation = 0;
  /** @internal Position the next step drives a kinematic body toward. */
  _kinematicTargetPositionX = 0;
  /** @internal */
  _kinematicTargetPositionY = 0;
  /** @internal Rotation the next step drives a kinematic body toward. */
  _kinematicTargetRotation = 0;
  /**
   * @internal Position physics last wrote to the Transform. A Transform
   * that still holds it carries no game write to capture. Kept per frame
   * for kinematic bodies; for dynamic and static bodies it is seeded on
   * disable, so a Transform write while dormant reads as pending on enable.
   */
  _lastWrittenPositionX = 0;
  /** @internal */
  _lastWrittenPositionY = 0;
  /** @internal Rotation physics last wrote to the Transform. */
  _lastWrittenRotation = 0;
  private _type: BodyType;
  private readonly config: RigidBodyConfig;
  private readonly transform = this.sibling(Transform);
  private physicsWorld!: PhysicsWorld;
  private readonly positionScratch = new Vec2Buffer();

  constructor(config: RigidBodyConfig) {
    super();
    const context = "RigidBodyComponent";
    assertFiniteNumber(context, "linearDamping", config.linearDamping, 0);
    assertFiniteNumber(context, "angularDamping", config.angularDamping, 0);
    // Negative gravity scale is a legal "float up".
    assertFiniteNumber(context, "gravityScale", config.gravityScale);
    this.config = config;
    this._type = config.type;
    this.syncRotation = config.syncRotation ?? true;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    this._bodyHandle = this.physicsWorld.createBody(this.entity, this.config);

    // Set initial position from Transform (use world coords for Rapier)
    const position = this.transform.getWorldPositionInto(this.positionScratch);
    const rotation = this.transform.worldRotation;
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (body) {
      body.setTranslation(
        {
          x: this.physicsWorld.toMeters(position.x),
          y: this.physicsWorld.toMeters(position.y),
        },
        true,
      );
      body.setRotation(rotation, true);
    }

    this._prevPositionX = position.x;
    this._prevPositionY = position.y;
    this._currPositionX = position.x;
    this._currPositionY = position.y;
    this._prevRotation = rotation;
    this._currRotation = rotation;
    this._kinematicTargetPositionX = position.x;
    this._kinematicTargetPositionY = position.y;
    this._kinematicTargetRotation = rotation;
    // Seeding the last-written pose too makes the spawn Transform read as
    // "no pending game write": a setPosition teleport issued before the
    // first interpolation pass would otherwise lose its target to a capture
    // of the stale spawn pose.
    this._lastWrittenPositionX = position.x;
    this._lastWrittenPositionY = position.y;
    this._lastWrittenRotation = rotation;

    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity. Rapier creates a body
    // enabled, so without this a body added to a dormant entity would keep
    // simulating: drifting under gravity and reporting collisions.
    body?.setEnabled(false);
  }

  /**
   * Put the Rapier body to sleep without freeing it — the allocation is
   * exactly what a reused entity gets to keep. Momentum and queued
   * forces/torques are cleared and joints are detached, so waking the body
   * cannot resume a motion — or a tether — that started a life ago.
   *
   * Record dynamic and static Transforms so only dormant writes count on
   * enable. Kinematic bodies keep pending targets written while active.
   */
  onDisable(): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    if (this._type !== "kinematic") {
      this.transform.getWorldPositionInto(this.positionScratch);
      this._lastWrittenPositionX = this.positionScratch.x;
      this._lastWrittenPositionY = this.positionScratch.y;
      this._lastWrittenRotation = this.transform.worldRotation;
    }
    this.physicsWorld._detachJointsForBody(this._bodyHandle);
    body.setLinvel({ x: 0, y: 0 }, false);
    body.setAngvel(0, false);
    body.resetForces(false);
    body.resetTorques(false);
    body.setEnabled(false);
  }

  /**
   * Bring the body back and snap interpolation to its current pose, so the
   * first frame after reuse renders where the body is rather than lerping
   * from where it slept.
   */
  onEnable(): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setEnabled(true);
    body.wakeUp();

    // Dormant Transform writes reposition every body type immediately, so
    // the first active frame and collision queries use the intended pose.
    if (this._hasPendingTargetPosition()) {
      const target = this.transform.getWorldPositionInto(this.positionScratch);
      body.setTranslation(
        {
          x: this.physicsWorld.toMeters(target.x),
          y: this.physicsWorld.toMeters(target.y),
        },
        true,
      );
      this.physicsWorld._markQueriesStale();
      this._kinematicTargetPositionX = target.x;
      this._kinematicTargetPositionY = target.y;
      this._lastWrittenPositionX = target.x;
      this._lastWrittenPositionY = target.y;
    }
    if (this._hasPendingTargetRotation()) {
      const target = this.transform.worldRotation;
      body.setRotation(target, true);
      this.physicsWorld._markQueriesStale();
      this._kinematicTargetRotation = target;
      this._lastWrittenRotation = target;
    }

    const translation = body.translation();
    const pos = this.positionScratch.set(
      this.physicsWorld.toPixels(translation.x),
      this.physicsWorld.toPixels(translation.y),
    );
    this._prevPositionX = pos.x;
    this._prevPositionY = pos.y;
    this._currPositionX = pos.x;
    this._currPositionY = pos.y;
    this._prevRotation = body.rotation();
    this._currRotation = body.rotation();
  }

  onDestroy(): void {
    if (this._bodyHandle !== -1) {
      this.physicsWorld.removeBody(this._bodyHandle);
      this._bodyHandle = -1;
    }
  }

  /** Apply a force (in pixels) at the center of mass. */
  applyForce(force: Vec2Like): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.addForce(
      {
        x: this.physicsWorld.toMeters(force.x),
        y: this.physicsWorld.toMeters(force.y),
      },
      true,
    );
  }

  /** Apply an impulse (in pixels) at the center of mass. */
  applyImpulse(impulse: Vec2Like): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.applyImpulse(
      {
        x: this.physicsWorld.toMeters(impulse.x),
        y: this.physicsWorld.toMeters(impulse.y),
      },
      true,
    );
  }

  /** Set linear velocity in pixels/s. */
  setVelocity(velocity: Vec2Like): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setLinvel(
      {
        x: this.physicsWorld.toMeters(velocity.x),
        y: this.physicsWorld.toMeters(velocity.y),
      },
      true,
    );
  }

  /** Set only the X component of velocity (px/s), preserving Y. */
  setVelocityX(vx: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    const velocity = body.linvel();
    body.setLinvel({ x: this.physicsWorld.toMeters(vx), y: velocity.y }, true);
  }

  /** Set only the Y component of velocity (px/s), preserving X. */
  setVelocityY(vy: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    const velocity = body.linvel();
    body.setLinvel({ x: velocity.x, y: this.physicsWorld.toMeters(vy) }, true);
  }

  /** Get linear velocity in pixels/s. */
  getVelocity(): Vec2 {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return Vec2.ZERO;
    const v = body.linvel();
    return new Vec2(
      this.physicsWorld.toPixels(v.x),
      this.physicsWorld.toPixels(v.y),
    );
  }

  /** Copy linear velocity in pixels/s into caller-owned scratch. */
  getVelocityInto(out: Vec2Buffer): Vec2Buffer {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return out.set(0, 0);
    const velocity = body.linvel();
    return out.set(
      this.physicsWorld.toPixels(velocity.x),
      this.physicsWorld.toPixels(velocity.y),
    );
  }

  /**
   * X component of linear velocity in pixels/s. Avoids the `Vec2`
   * allocation of `getVelocity()` — prefer this and `velocityY` on a
   * per-frame read path. Reading both components calls into Rapier twice;
   * use `getVelocityInto()` to copy both coordinates with one read.
   */
  get velocityX(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return 0;
    return this.physicsWorld.toPixels(body.linvel().x);
  }

  /**
   * Y component of linear velocity in pixels/s. Avoids the `Vec2`
   * allocation of `getVelocity()`.
   */
  get velocityY(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return 0;
    return this.physicsWorld.toPixels(body.linvel().y);
  }

  /** Speed (velocity magnitude) in pixels/s. No `Vec2` allocation. */
  get speed(): number {
    return Math.sqrt(this.speedSquared);
  }

  /**
   * Squared speed in (pixels/s)². Cheaper than `speed` when only comparing
   * magnitudes (e.g. against a threshold).
   */
  get speedSquared(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return 0;
    const v = body.linvel();
    const vx = this.physicsWorld.toPixels(v.x);
    const vy = this.physicsWorld.toPixels(v.y);
    return vx * vx + vy * vy;
  }

  /**
   * Apply torque, in Rapier's native units: the value is not converted from
   * pixels, and angular inertia scales with `pixelsPerMeter`⁻⁴, so the same
   * torque spins a body 16× faster at 100 px/m than at 50. Retune after
   * changing the scale, as with spring stiffness.
   */
  applyTorque(torque: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.addTorque(torque, true);
  }

  /** Set angular velocity in radians/s (Rapier's native unit, not scaled by `pixelsPerMeter`). */
  setAngularVelocity(v: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setAngvel(v, true);
  }

  /** Get angular velocity in radians/s. */
  getAngularVelocity(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return 0;
    return body.angvel();
  }

  /**
   * Mass derived from the attached colliders (density × shape size).
   * `applyImpulse(dv.scale(getMass()))` changes velocity by exactly `dv` px/s.
   */
  getMass(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return 0;
    return body.mass();
  }

  /**
   * Multiply gravity for this body: `1` is the scene's gravity, `0` removes
   * it, larger values fall faster. This is the per-body control a platformer
   * needs for variable jump height and fast-fall, without moving scene
   * gravity for every other body. `scale` must be finite; a `NaN` would
   * write `NaN` into the body's position at the next step and nothing
   * recovers it.
   *
   * Callable before the component is added — the value is applied when the
   * Rapier body is created.
   */
  setGravityScale(scale: number): void {
    assertFiniteNumber("RigidBodyComponent.setGravityScale", "scale", scale);
    // Keep the construction config aligned with the live body so a pre-add
    // write and a later body recreation use the same value.
    this.config.gravityScale = scale;
    if (this._bodyHandle === -1) return;
    this.physicsWorld.getBody(this._bodyHandle)?.setGravityScale(scale, true);
  }

  /** Gravity multiplier for this body. `1` unless set. */
  get gravityScale(): number {
    if (this._bodyHandle === -1) return this.config.gravityScale ?? 1;
    return this.physicsWorld.getBody(this._bodyHandle)?.gravityScale() ?? 1;
  }

  /**
   * Set linear velocity damping. Values must be finite and at least 0.
   * Callable before the component is added; the value applies at creation.
   */
  setLinearDamping(damping: number): void {
    assertRequiredFinite(
      "RigidBodyComponent.setLinearDamping",
      "damping",
      damping,
      0,
    );
    this.config.linearDamping = damping;
    if (this._bodyHandle === -1) return;
    this.physicsWorld.getBody(this._bodyHandle)?.setLinearDamping(damping);
  }

  /**
   * Set angular velocity damping. Values must be finite and at least 0.
   * Callable before the component is added; the value applies at creation.
   */
  setAngularDamping(damping: number): void {
    assertRequiredFinite(
      "RigidBodyComponent.setAngularDamping",
      "damping",
      damping,
      0,
    );
    this.config.angularDamping = damping;
    if (this._bodyHandle === -1) return;
    this.physicsWorld.getBody(this._bodyHandle)?.setAngularDamping(damping);
  }

  /**
   * Set which translation axes are enabled. A locked axis ignores forces,
   * impulses and contacts; a velocity written with `setVelocity` still
   * moves the body along it. Callable before the component is added — the
   * locks are applied when the Rapier body is created.
   */
  setEnabledTranslations(enableX: boolean, enableY: boolean): void {
    this.config.lockTranslationX = !enableX;
    this.config.lockTranslationY = !enableY;
    if (this._bodyHandle === -1) return;
    this.physicsWorld
      .getBody(this._bodyHandle)
      ?.setEnabledTranslations(enableX, enableY, true);
  }

  /**
   * Lock or unlock rotation. A locked body ignores torques and contact
   * spin; `setAngularVelocity` still turns it. Callable before the
   * component is added — the lock is applied when the Rapier body is
   * created.
   */
  lockRotations(locked: boolean): void {
    this.config.fixedRotation = locked;
    if (this._bodyHandle === -1) return;
    this.physicsWorld.getBody(this._bodyHandle)?.lockRotations(locked, true);
  }

  /**
   * Switch the body type at runtime — a dead enemy becomes `"static"` so
   * nothing pushes it and it pushes nothing; a carried crate becomes
   * `"kinematic"` while held. Linear and angular velocity are cleared by
   * the switch; locks, gravity scale, damping, colliders and mass are kept.
   * The drawn pose is the exact pose at the switch. Callable before
   * `entity.add()`; the body is created as the new type.
   */
  setType(type: BodyType): void {
    if (type === this._type) return;
    this.config.type = type;
    this._type = type;
    if (this._bodyHandle === -1) return;
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setBodyType(rapierBodyType(type), true);
    if (type === "dynamic") {
      // Rapier sums a body's mass at the next step; without this the first
      // step's `applyImpulse` on the new dynamic body is ignored.
      body.recomputeMassPropertiesFromColliders();
    }
    const translation = body.translation();
    const pos = this.positionScratch.set(
      this.physicsWorld.toPixels(translation.x),
      this.physicsWorld.toPixels(translation.y),
    );
    const rot = body.rotation();
    this._prevPositionX = pos.x;
    this._prevPositionY = pos.y;
    this._currPositionX = pos.x;
    this._currPositionY = pos.y;
    this._prevRotation = rot;
    this._currRotation = rot;
    if (type === "kinematic") {
      // The current Transform reads as "no pending write", so the next
      // post-step snaps it to the exact pose instead of driving the body
      // toward the interpolated one.
      this._kinematicTargetPositionX = pos.x;
      this._kinematicTargetPositionY = pos.y;
      this._kinematicTargetRotation = rot;
      this.transform.getWorldPositionInto(this.positionScratch);
      this._lastWrittenPositionX = this.positionScratch.x;
      this._lastWrittenPositionY = this.positionScratch.y;
      this._lastWrittenRotation = this.transform.worldRotation;
    } else if (type === "static") {
      // No system writes a static body's Transform.
      this.transform.setWorldPosition(pos.x, pos.y);
      if (this.syncRotation) this.transform.worldRotation = rot;
    }
  }

  /**
   * Body position in pixels — the exact simulated pose. A dynamic or
   * kinematic body's `Transform` holds the interpolated pose that gets
   * drawn: smooth, and at most one fixed step behind this value.
   *
   * Falls back to the entity's world position when no Rapier body exists
   * (e.g. after teardown has destroyed it).
   */
  get position(): Vec2 {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return this.transform.worldPosition;
    const t = body.translation();
    return new Vec2(
      this.physicsWorld.toPixels(t.x),
      this.physicsWorld.toPixels(t.y),
    );
  }

  /** Copy the exact simulated position in pixels into caller-owned scratch. */
  getPositionInto(out: Vec2Buffer): Vec2Buffer {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return this.transform.getWorldPositionInto(out);
    const position = body.translation();
    return out.set(
      this.physicsWorld.toPixels(position.x),
      this.physicsWorld.toPixels(position.y),
    );
  }

  /**
   * X component of the exact simulated position in pixels. Avoids the `Vec2`
   * allocation of `position` — prefer this and `positionY` on a per-frame
   * read path.
   */
  get positionX(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body)
      return this.transform.getWorldPositionInto(this.positionScratch).x;
    return this.physicsWorld.toPixels(body.translation().x);
  }

  /**
   * Y component of the exact simulated position in pixels. Avoids the `Vec2`
   * allocation of `position`.
   */
  get positionY(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body)
      return this.transform.getWorldPositionInto(this.positionScratch).y;
    return this.physicsWorld.toPixels(body.translation().y);
  }

  /**
   * Body rotation in radians — the exact simulated pose. A dynamic or
   * kinematic body's `Transform` holds the interpolated rotation that gets
   * drawn: smooth, and at most one fixed step behind this value.
   *
   * Falls back to the entity's world rotation when no Rapier body exists.
   */
  get rotation(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return this.transform.worldRotation;
    return body.rotation();
  }

  /**
   * Teleport to a position in pixels — no interpolation, no smoothing, for
   * any body type. On a kinematic body, `transform.setPosition()` instead
   * moves it there smoothly over one step. A static body's Transform moves
   * with it (no system writes one otherwise).
   */
  setPosition(x: number, y: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setTranslation(
      {
        x: this.physicsWorld.toMeters(x),
        y: this.physicsWorld.toMeters(y),
      },
      true,
    );
    this.physicsWorld._markQueriesStale();
    const pos = this.positionScratch.set(x, y);
    this._prevPositionX = pos.x;
    this._prevPositionY = pos.y;
    this._currPositionX = pos.x;
    this._currPositionY = pos.y;
    if (this._type === "static") this.transform.setWorldPosition(pos.x, pos.y);
    // Without this, the step after a kinematic teleport would drive the body
    // back toward the stale pre-teleport target.
    this._kinematicTargetPositionX = pos.x;
    this._kinematicTargetPositionY = pos.y;
    // The teleport also supersedes any Transform write the capture has not
    // consumed yet — marking the current pose as already written keeps that
    // write from becoming the next step's target and pulling the body off
    // the teleport destination.
    this.transform.getWorldPositionInto(this.positionScratch);
    this._lastWrittenPositionX = this.positionScratch.x;
    this._lastWrittenPositionY = this.positionScratch.y;
  }

  /**
   * Teleport to a rotation in radians — no interpolation, no smoothing, for
   * any body type. The rotation counterpart of `setPosition`; a static
   * body's Transform rotates with it when `syncRotation` is on.
   */
  setRotation(radians: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setRotation(radians, true);
    this.physicsWorld._markQueriesStale();
    this._prevRotation = radians;
    this._currRotation = radians;
    if (this._type === "static" && this.syncRotation) {
      this.transform.worldRotation = radians;
    }
    this._kinematicTargetRotation = radians;
    // Supersede any not-yet-captured Transform rotation, as in setPosition.
    this._lastWrittenRotation = this.transform.worldRotation;
  }

  /**
   * @internal True when the Transform's world position no longer holds what
   * physics last wrote — i.e. the game (or a moved parent) repositioned it,
   * and the write is waiting to become the kinematic step target.
   */
  _hasPendingTargetPosition(): boolean {
    const pos = this.transform.getWorldPositionInto(this.positionScratch);
    return (
      Math.abs(pos.x - this._lastWrittenPositionX) > POSE_EPSILON ||
      Math.abs(pos.y - this._lastWrittenPositionY) > POSE_EPSILON
    );
  }

  /**
   * @internal Rotation counterpart of `_hasPendingTargetPosition`. Compares
   * along the shortest arc: a game that normalizes its own accumulated
   * rotation writes a numerically different, visually identical angle, which
   * is not a new target.
   */
  _hasPendingTargetRotation(): boolean {
    return (
      Math.abs(
        MathUtils.shortestAngleBetween(
          this._lastWrittenRotation,
          this.transform.worldRotation,
        ),
      ) > POSE_EPSILON
    );
  }

  /**
   * @internal Adopt any pose the game wrote to the Transform as the
   * kinematic step target. Runs before each physics step and before the
   * interpolation lerp overwrites the Transform, so targets stay fresh even
   * on frames that run several steps.
   */
  _capturePendingTarget(): void {
    if (this._hasPendingTargetPosition()) {
      this.transform.getWorldPositionInto(this.positionScratch);
      this._kinematicTargetPositionX = this.positionScratch.x;
      this._kinematicTargetPositionY = this.positionScratch.y;
    }
    if (this._hasPendingTargetRotation()) {
      this._kinematicTargetRotation = this.transform.worldRotation;
    }
  }
}
