import { Component, Transform, Vec2, serializable } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PhysicsWorldKey } from "./types.js";
import type { BodyType, RigidBodyConfig } from "./types.js";

/** Serialized snapshot of a RigidBodyComponent. */
export interface RigidBodyData {
  type: BodyType;
  syncRotation: boolean;
  fixedRotation?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  ccd?: boolean;
  velocity: { x: number; y: number };
  angularVelocity: number;
}

/**
 * Wraps a Rapier rigid body. All public API values are in pixels.
 *
 * Component ordering: Transform must be added before RigidBodyComponent.
 */
@serializable
export class RigidBodyComponent extends Component {
  // onAdd() reads the sibling Transform's world position.
  static restorePriority = 10;

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
  private readonly config: RigidBodyConfig;
  private readonly transform = this.sibling(Transform);
  private physicsWorld!: PhysicsWorld;

  constructor(config: RigidBodyConfig) {
    super();
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

    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity. Rapier creates a body
    // enabled, so without this a body added to a dormant entity would keep
    // simulating: drifting under gravity and reporting collisions.
    body?.setEnabled(false);
  }

  /**
   * Put the Rapier body to sleep without freeing it — the allocation is
   * exactly what a reused entity gets to keep. Momentum and queued
   * forces/torques are cleared, so waking the body cannot resume a motion
   * that started a life ago.
   */
  onDisable(): void {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return;
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
    // serialize() reads config.gravityScale, so it must track the live body.
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
   * Body position in pixels — the exact simulated pose. A dynamic body's
   * `Transform` holds the interpolated pose that gets drawn: smooth, and at
   * most one fixed step behind this value.
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
   * Body rotation in radians — the exact simulated pose. A dynamic body's
   * `Transform` holds the interpolated rotation that gets drawn: smooth, and
   * at most one fixed step behind this value.
   *
   * Falls back to the entity's world rotation when no Rapier body exists.
   */
  get rotation(): number {
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (!body) return this.transform.worldRotation;
    return body.rotation();
  }

  /** Teleport to a position in pixels. Skips interpolation on next frame. */
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
  }

  /** Serialize the component into a plain data object. */
  serialize(): RigidBodyData {
    const vel = this.getVelocity();
    const data: RigidBodyData = {
      type: this.type,
      syncRotation: this.syncRotation,
      velocity: { x: vel.x, y: vel.y },
      angularVelocity: this.getAngularVelocity(),
    };
    if (this.config.fixedRotation !== undefined) data.fixedRotation = this.config.fixedRotation;
    if (this.config.linearDamping !== undefined) data.linearDamping = this.config.linearDamping;
    if (this.config.angularDamping !== undefined) data.angularDamping = this.config.angularDamping;
    if (this.config.gravityScale !== undefined) data.gravityScale = this.config.gravityScale;
    if (this.config.ccd !== undefined) data.ccd = this.config.ccd;
    return data;
  }

  /** Create a RigidBodyComponent from a serialized snapshot. */
  static fromSnapshot(data: RigidBodyData): RigidBodyComponent {
    const config: RigidBodyConfig = {
      type: data.type,
      syncRotation: data.syncRotation,
    };
    if (data.fixedRotation !== undefined) config.fixedRotation = data.fixedRotation;
    if (data.linearDamping !== undefined) config.linearDamping = data.linearDamping;
    if (data.angularDamping !== undefined) config.angularDamping = data.angularDamping;
    if (data.gravityScale !== undefined) config.gravityScale = data.gravityScale;
    if (data.ccd !== undefined) config.ccd = data.ccd;
    return new RigidBodyComponent(config);
  }

  /** Restore runtime state (velocities) after the Rapier body has been created. */
  afterRestore(data: unknown): void {
    const d = data as RigidBodyData;
    this.setVelocity(d.velocity);
    this.setAngularVelocity(d.angularVelocity);
  }
}
