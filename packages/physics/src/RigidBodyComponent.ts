import { Component, Transform, Vec2 } from "@yage/core";
import type { Vec2Like } from "@yage/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PhysicsWorldKey } from "./types.js";
import type { BodyType, RigidBodyConfig } from "./types.js";

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
  /** @internal If true, skip interpolation on next frame (teleport). */
  _teleported = false;

  private readonly config: RigidBodyConfig;
  private physicsWorld!: PhysicsWorld;

  constructor(config: RigidBodyConfig) {
    super();
    this.config = config;
    this.type = config.type;
    this.syncRotation = config.syncRotation ?? true;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);
    const transform = this.entity.get(Transform);

    this._bodyHandle = this.physicsWorld.createBody(this.entity, this.config);

    // Set initial position from Transform (use world coords for Rapier)
    const body = this.physicsWorld.getBody(this._bodyHandle);
    if (body) {
      body.setTranslation(
        {
          x: this.physicsWorld.toMeters(transform.worldPosition.x),
          y: this.physicsWorld.toMeters(transform.worldPosition.y),
        },
        true,
      );
      body.setRotation(transform.worldRotation, true);
    }

    this._prevPosition = transform.worldPosition;
    this._currPosition = transform.worldPosition;
    this._prevRotation = transform.worldRotation;
    this._currRotation = transform.worldRotation;
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
    this._teleported = true;
  }
}
