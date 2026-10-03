import { tuningNumbers } from "../core/validate.js";
import { Component, type Vec2Like } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
  type PhysicsWorld,
} from "@yagejs/physics";

import { MovingSurface } from "./MovingSurface.js";

const DOWN = { x: 0, y: 1 } as const;
/** Thin enough to describe the surface under the feet rather than the wall beside them. */
const PROBE_THICKNESS = 2;

export interface GroundProbeTuning {
  /** How wide the cast is. Narrower than the body, so a ledge edge is forgiving. */
  readonly width: number;
  /** How far below the feet it looks, px. */
  readonly distance: number;
  /** Extra support reach for bounded ground retention. Absent on unassisted bodies. */
  readonly snapDistance?: number;
  readonly maxSlopeAngle?: number;
  /** Packed physics groups for ground queries. Sensors are excluded. */
  readonly filterGroups: number;
}

export class GroundProbe extends Component {
  private readonly tuning: GroundProbeTuning;
  private world!: PhysicsWorld;
  private body!: RigidBodyComponent;
  private collider?: ColliderComponent;
  private _grounded = false;
  private _normal = { x: 0, y: -1 };
  private _distance = Infinity;

  private _support: RigidBodyComponent | undefined;
  private _surface: MovingSurface | undefined;

  get support(): RigidBodyComponent | undefined {
    return this._support;
  }
  get supportVelocity(): Readonly<{ x: number; y: number }> {
    return this._surface?.velocity ?? this.actualSupportVelocity;
  }
  get actualSupportVelocity(): Readonly<{ x: number; y: number }> {
    return {
      x: this._support?.velocityX ?? 0,
      y: this._support?.velocityY ?? 0,
    };
  }

  get normal(): Readonly<{ x: number; y: number }> {
    return this._normal;
  }
  get distance(): number {
    return this._distance;
  }
  get nearSupport(): boolean {
    return Number.isFinite(this._distance);
  }
  get assisted(): boolean {
    return this.tuning.snapDistance !== undefined;
  }

  constructor(params: { tuning: GroundProbeTuning }) {
    super();
    tuningNumbers("GroundProbe", params.tuning);
    this.tuning = Object.freeze({ ...params.tuning });
    if (this.tuning.width <= 0 || (this.tuning.maxSlopeAngle ?? 45) >= 90)
      throw new Error(
        "GroundProbe: width must be positive and maxSlopeAngle must be < 90",
      );
  }

  onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.body = this.entity.get(RigidBodyComponent);
    if (this.assisted) this.collider = this.entity.get(ColliderComponent);
  }

  get grounded(): boolean {
    return this._grounded;
  }

  isWalkable(normal: Vec2Like): boolean {
    if (!this.assisted) return -normal.y > Math.abs(normal.x);
    // Numerical normals around an authored 45° face need a small tolerance.
    return (
      -normal.y >=
      Math.cos(((this.tuning.maxSlopeAngle ?? 45) * Math.PI) / 180) - 0.001
    );
  }

  fixedUpdate(): void {
    // Assisted bodies query the live stance shape so ramp crests remain support.
    // Unassisted bodies retain the foot strip; both origins are simulation poses.
    const shape = this.collider?.config.shape;
    const offset = this.collider?.config.offset;
    let hit = this.world.castShape(
      shape ?? {
        type: "box",
        width: this.tuning.width,
        height: PROBE_THICKNESS,
      },
      shape
        ? {
            x: this.body.positionX + (offset?.x ?? 0),
            y: this.body.positionY + (offset?.y ?? 0),
          }
        : {
            x: this.body.positionX,
            y: this.body.positionY - PROBE_THICKNESS / 2,
          },
      DOWN,
      Math.max(this.tuning.distance, this.tuning.snapDistance ?? 0),
      { filterGroups: this.tuning.filterGroups, excludeEntity: this.entity },
    );
    // A steep face can be closer to the full body than its floor contact.
    // Only contacts near the feet support the body. Full-body overlap with a
    // one-way platform around the head must not refill airborne charges.
    if (
      shape &&
      hit &&
      (!this.isWalkable(hit.normal) ||
        hit.point.y < this.body.positionY - this.tuning.distance)
    )
      hit = this.world.castShape(
        { type: "box", width: PROBE_THICKNESS, height: PROBE_THICKNESS },
        {
          x: this.body.positionX,
          y: this.body.positionY - PROBE_THICKNESS / 2,
        },
        DOWN,
        this.tuning.distance,
        { filterGroups: this.tuning.filterGroups, excludeEntity: this.entity },
      );
    const walkable = hit !== null && this.isWalkable(hit.normal);
    this._support =
      walkable && hit ? hit.entity.tryGet(RigidBodyComponent) : undefined;
    this._surface =
      walkable && hit ? hit.entity.tryGet(MovingSurface) : undefined;
    this._distance = walkable && hit ? hit.distance : Infinity;
    this._normal =
      walkable && hit ? { x: hit.normal.x, y: hit.normal.y } : { x: 0, y: -1 };
    this._grounded = this._distance <= this.tuning.distance;
  }
}
