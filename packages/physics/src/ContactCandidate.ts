import type { Entity } from "@yagejs/core";
import type { ColliderComponent } from "./ColliderComponent.js";
import type { ContactCandidate } from "./types.js";

/**
 * @internal Per-collider state captured just before a step that will run
 * contact filters. Rapier's JS wrappers cannot be read while the step is in
 * progress (the WASM world is mutably borrowed, and any wrapper call throws
 * an aliasing error), so filters read from this snapshot instead. One entry
 * per collider, allocated at collider creation and mutated in place each
 * step — never allocated on the step path.
 */
export interface PreStepColliderState {
  /** Collider world position in pixels. */
  x: number;
  y: number;
  /** Collider world rotation in radians. */
  rotation: number;
  /** Parent body linear velocity in pixels/s. */
  vx: number;
  vy: number;
}

/**
 * @internal Reused implementation of `ContactCandidate`. A single instance
 * per `PhysicsWorld` is re-pointed at each candidate pair before its filter
 * runs — contact filters fire for every candidate pair every step, so a
 * fresh object per call would be steady GC pressure at 60Hz.
 */
export class MutableContactCandidate implements ContactCandidate {
  other!: Entity;
  otherCollider!: ColliderComponent;
  dt = 0;

  private _self!: PreStepColliderState;
  private _other!: PreStepColliderState;

  _set(
    self: PreStepColliderState,
    other: PreStepColliderState,
    otherEntity: Entity,
    otherComponent: ColliderComponent,
    dt: number,
  ): void {
    this._self = self;
    this._other = other;
    this.other = otherEntity;
    this.otherCollider = otherComponent;
    this.dt = dt;
  }

  get selfX(): number {
    return this._self.x;
  }

  get selfY(): number {
    return this._self.y;
  }

  get selfRotation(): number {
    return this._self.rotation;
  }

  get selfVelocityX(): number {
    return this._self.vx;
  }

  get selfVelocityY(): number {
    return this._self.vy;
  }

  get otherX(): number {
    return this._other.x;
  }

  get otherY(): number {
    return this._other.y;
  }

  get otherRotation(): number {
    return this._other.rotation;
  }

  get otherVelocityX(): number {
    return this._other.vx;
  }

  get otherVelocityY(): number {
    return this._other.vy;
  }
}
