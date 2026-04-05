import { Component, Transform, Vec2, serializable } from "@yage/core";
import type { Vec2Like } from "@yage/core";
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
  /** @internal True if this body was put to sleep by the pause system. */
  _pauseSleeping = false;

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
