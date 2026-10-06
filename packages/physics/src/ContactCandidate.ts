import type { Entity } from "@yagejs/core";
import type { ColliderComponent } from "./ColliderComponent.js";
import type { ContactCandidate } from "./types.js";

/** @internal Collider world pose, independent of its body's velocity. */
export interface ColliderPose {
  /** Collider world position in pixels. */
  x: number;
  y: number;
  /** Collider world rotation in radians. */
  rotation: number;
}

/** @internal Pose and pass-through state at the start of a simulated step. */
export interface ColliderStepPose extends ColliderPose {
  droppingThrough: boolean;
}

/**
 * @internal Per-collider state captured before a filtered step. Rapier's
 * wrappers cannot be read during the step because its WASM world is mutably
 * borrowed. Filters read this snapshot instead. Each collider's entry and
 * previous pose are allocated at creation and mutated in place each step.
 */
export interface PreStepColliderState extends ColliderPose {
  /** Parent body linear velocity in pixels/s. */
  vx: number;
  vy: number;
  /** Start pose of the last advancing step; zero-duration refreshes keep it. */
  previous: ColliderStepPose;
  /** Completed step that owns `previous`, or -1 after a discontinuity. */
  previousStep: number;
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
  selfShapeIndex = 0;
  otherShapeIndex = 0;
  dt = 0;

  private _self!: PreStepColliderState;
  private _other!: PreStepColliderState;

  _set(
    self: PreStepColliderState,
    other: PreStepColliderState,
    otherEntity: Entity,
    otherComponent: ColliderComponent,
    selfShapeIndex: number,
    otherShapeIndex: number,
    dt: number,
  ): void {
    this._self = self;
    this._other = other;
    this.other = otherEntity;
    this.otherCollider = otherComponent;
    this.selfShapeIndex = selfShapeIndex;
    this.otherShapeIndex = otherShapeIndex;
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
