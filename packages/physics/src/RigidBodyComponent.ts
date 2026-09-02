import { Component, MathUtils, Transform, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PhysicsWorldKey } from "./types.js";
import type { BodyType, RigidBodyConfig } from "./types.js";
import { assertFiniteNumber } from "./validate.js";

/**
 * Tolerance for deciding whether the game wrote a Transform since physics
 * last did. Well above the float noise a world↔local round-trip through a
 * parent chain produces, well below any perceptible motion.
 */
const POSE_EPSILON = 1e-6;

/**
 * Wraps a Rapier rigid body. All public API values are in pixels.
 *
 * Component ordering: Transform must be added before RigidBodyComponent.
 */
export class RigidBodyComponent extends Component {
  /** Body type (dynamic, static, kinematic). */
  readonly type: BodyType;

  /** If false, physics will not write rotation back to Transform. */
  syncRotation: boolean;

  /** @internal Rapier body handle, set during onAdd. */
  _bodyHandle = -1;

  /** @internal Previous position for interpolation. */
  _prevPosition: Vec2 = Vec2.ZERO;
  /** @internal Previous rotation for interpolation. */
  _prevRotation = 0;
  /** @internal Current authoritative position (post physics step). */
  _currPosition: Vec2 = Vec2.ZERO;
  /** @internal Current authoritative rotation (post physics step). */
  _currRotation = 0;
  /** @internal Position the next step drives a kinematic body toward. */
  _kinematicTargetPosition: Vec2 = Vec2.ZERO;
  /** @internal Rotation the next step drives a kinematic body toward. */
  _kinematicTargetRotation = 0;
  /**
   * @internal Position physics last wrote to the Transform (kinematic only).
   * A Transform that still holds it carries no game write to capture.
   */
  _lastWrittenPosition: Vec2 = Vec2.ZERO;
  /** @internal Rotation physics last wrote to the Transform (kinematic only). */
  _lastWrittenRotation = 0;
  private readonly config: RigidBodyConfig;
  private readonly transform = this.sibling(Transform);
  private physicsWorld!: PhysicsWorld;

  constructor(config: RigidBodyConfig) {
    super();
    const context = "RigidBodyComponent";
    assertFiniteNumber(context, "linearDamping", config.linearDamping, 0);
    assertFiniteNumber(context, "angularDamping", config.angularDamping, 0);
    // Negative gravity scale is a legal "float up".
    assertFiniteNumber(context, "gravityScale", config.gravityScale);
    this.config = config;
    this.type = config.type;
    this.syncRotation = config.syncRotation ?? true;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    this._bodyHandle = this.physicsWorld.createBody(this.entity, this.config);

    // Set initial position from Transform (use world coords for Rapier)
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (body) {
      body.setTranslation(
        {
          x: this.physicsWorld.toMeters(this.transform.worldPosition.x),
          y: this.physicsWorld.toMeters(this.transform.worldPosition.y),
        },
        true,
      );
      body.setRotation(this.transform.worldRotation, true);
    }

    this._prevPosition = this.transform.worldPosition;
    this._currPosition = this.transform.worldPosition;
    this._prevRotation = this.transform.worldRotation;
    this._currRotation = this.transform.worldRotation;
    this._kinematicTargetPosition = this.transform.worldPosition;
    this._kinematicTargetRotation = this.transform.worldRotation;
    // Seeding the last-written pose too makes the spawn Transform read as
    // "no pending game write": a setPosition teleport issued before the
    // first interpolation pass would otherwise lose its target to a capture
    // of the stale spawn pose.
    this._lastWrittenPosition = this.transform.worldPosition;
    this._lastWrittenRotation = this.transform.worldRotation;

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
   */
  onDisable(): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
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

    // A Transform write made while a kinematic entity was dormant is the
    // game repositioning it for reuse. Teleport the body there — gliding
    // from where it slept would streak across the map, and the first drawn
    // frame would show the stale sleep pose.
    if (this.type === "kinematic") {
      if (this._hasPendingTargetPosition()) {
        const target = this.transform.worldPosition;
        body.setTranslation(
          {
            x: this.physicsWorld.toMeters(target.x),
            y: this.physicsWorld.toMeters(target.y),
          },
          true,
        );
        this._kinematicTargetPosition = target;
        this._lastWrittenPosition = target;
      }
      if (this._hasPendingTargetRotation()) {
        const target = this.transform.worldRotation;
        body.setRotation(target, true);
        this._kinematicTargetRotation = target;
        this._lastWrittenRotation = target;
      }
    }

    const translation = body.translation();
    const pos = new Vec2(
      this.physicsWorld.toPixels(translation.x),
      this.physicsWorld.toPixels(translation.y),
    );
    this._prevPosition = pos;
    this._currPosition = pos;
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
    const vel = this.getVelocity();
    this.setVelocity({ x: vx, y: vel.y });
  }

  /** Set only the Y component of velocity (px/s), preserving X. */
  setVelocityY(vy: number): void {
    const vel = this.getVelocity();
    this.setVelocity({ x: vel.x, y: vy });
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

  /**
   * X component of linear velocity in pixels/s. Avoids the `Vec2`
   * allocation of `getVelocity()` — prefer this and `velocityY` on a
   * per-frame read path. Reading both components calls into Rapier twice;
   * for both as numbers without the double call, `getVelocity()` is still
   * the option.
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

  /** Apply torque. */
  applyTorque(torque: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.addTorque(torque, true);
  }

  /** Set angular velocity in radians/s. */
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
   * gravity for every other body.
   *
   * Callable before the component is added — the value is applied when the
   * Rapier body is created.
   */
  setGravityScale(scale: number): void {
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

  /** Set which translation axes are enabled at runtime. */
  setEnabledTranslations(enableX: boolean, enableY: boolean): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setEnabledTranslations(enableX, enableY, true);
  }

  /** Lock or unlock rotations at runtime. */
  lockRotations(locked: boolean): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.lockRotations(locked, true);
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

  /**
   * X component of the exact simulated position in pixels. Avoids the `Vec2`
   * allocation of `position` — prefer this and `positionY` on a per-frame
   * read path.
   */
  get positionX(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return this.transform.worldPosition.x;
    return this.physicsWorld.toPixels(body.translation().x);
  }

  /**
   * Y component of the exact simulated position in pixels. Avoids the `Vec2`
   * allocation of `position`.
   */
  get positionY(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return this.transform.worldPosition.y;
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
   * moves it there smoothly over one step.
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
    const pos = new Vec2(x, y);
    this._prevPosition = pos;
    this._currPosition = pos;
    // Without this, the step after a kinematic teleport would drive the body
    // back toward the stale pre-teleport target.
    this._kinematicTargetPosition = pos;
    // The teleport also supersedes any Transform write the capture has not
    // consumed yet — marking the current pose as already written keeps that
    // write from becoming the next step's target and pulling the body off
    // the teleport destination.
    this._lastWrittenPosition = this.transform.worldPosition;
  }

  /**
   * Teleport to a rotation in radians — no interpolation, no smoothing, for
   * any body type. The rotation counterpart of `setPosition`.
   */
  setRotation(radians: number): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
    body.setRotation(radians, true);
    this._prevRotation = radians;
    this._currRotation = radians;
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
    const pos = this.transform.worldPosition;
    return (
      Math.abs(pos.x - this._lastWrittenPosition.x) > POSE_EPSILON ||
      Math.abs(pos.y - this._lastWrittenPosition.y) > POSE_EPSILON
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
      this._kinematicTargetPosition = this.transform.worldPosition;
    }
    if (this._hasPendingTargetRotation()) {
      this._kinematicTargetRotation = this.transform.worldRotation;
    }
  }
}
