import { tuningNumbers } from "../core/validate.js";
import { Component, type Entity, type Vec2Like } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
  type PhysicsWorld,
} from "@yagejs/physics";
import { MovingSurface } from "./MovingSurface.js";

export interface LedgeTuning {
  readonly bodyWidth: number;
  readonly ledgeHandHeight: number;
  readonly ledgeGrabReach: number;
  readonly ledgeGrabTolerance: number;
}

export interface LedgeContact {
  readonly entity: Entity;
  readonly body: RigidBodyComponent;
  readonly side: -1 | 1;
  readonly localX: number;
  readonly localY: number;
}

/** Measures a flat top, its outside face, and the full standing body's clearance. */
export class LedgeProbe extends Component {
  private world!: PhysicsWorld;
  private body!: RigidBodyComponent;
  private collider!: ColliderComponent;

  constructor(
    private readonly params: {
      tuning: LedgeTuning;
      grab: number;
      volume: number;
    },
  ) {
    super();
    tuningNumbers("LedgeProbe", params.tuning);
    this.params = { ...params, tuning: Object.freeze({ ...params.tuning }) };
  }

  onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.body = this.entity.get(RigidBodyComponent);
    this.collider = this.entity.get(ColliderComponent);
  }

  find(side: -1 | 1): LedgeContact | undefined {
    const { tuning, grab } = this.params;
    const reach = tuning.bodyWidth / 2 + tuning.ledgeGrabReach;
    const handY = this.body.positionY - tuning.ledgeHandHeight;
    const options = { filterGroups: grab, excludeEntity: this.entity };
    const top = this.world.raycast(
      {
        x: this.body.positionX + side * reach,
        y: handY - tuning.ledgeGrabTolerance,
      },
      { x: 0, y: 1 },
      tuning.ledgeGrabTolerance * 2,
      options,
    );
    if (!top || top.normal.y > -0.99) return;
    const face = this.world.raycast(
      { x: this.body.positionX, y: top.point.y + 2 },
      { x: side, y: 0 },
      reach,
      options,
    );
    if (!face || face.entity !== top.entity || face.normal.x * side > -0.99)
      return;
    const support = top.entity.tryGet(RigidBodyComponent);
    if (!support) return;
    const contact: LedgeContact = {
      entity: top.entity,
      body: support,
      side,
      localX: face.point.x - support.positionX,
      localY: top.point.y - support.positionY,
    };
    const points = this.points(contact);
    if (
      !this.clear(points.hang, points.raised) ||
      !this.clear(points.raised, points.stand)
    )
      return;
    if (
      !this.clear(
        { x: this.body.positionX, y: this.body.positionY },
        points.hang,
      )
    )
      return;
    return contact;
  }

  points(contact: LedgeContact, dt = 0) {
    const surface = contact.entity.tryGet(MovingSurface);
    const x =
      contact.body.positionX +
      contact.localX +
      (surface?.velocity.x ?? contact.body.velocityX) * dt;
    const y =
      contact.body.positionY +
      contact.localY +
      (surface?.velocity.y ?? contact.body.velocityY) * dt;
    const outside = x - contact.side * (this.params.tuning.bodyWidth / 2 + 1);
    return {
      hang: { x: outside, y: y + this.params.tuning.ledgeHandHeight },
      raised: { x: outside, y: y - 0.75 },
      stand: {
        x: x + contact.side * (this.params.tuning.bodyWidth / 2 + 2),
        y: y - 0.75,
      },
    };
  }

  clearStep(
    from: Vec2Like,
    to: Vec2Like,
    contact: LedgeContact,
    dt: number,
  ): boolean {
    const current = this.points(contact).hang;
    const next = this.points(contact, dt).hang;
    const relativeEnd = {
      x: to.x - (next.x - current.x),
      y: to.y - (next.y - current.y),
    };
    // In the support's current frame, following it is no movement. Other solids
    // are checked conservatively here too, then along the actual world path.
    return (
      this.clear(from, relativeEnd) && this.clear(from, to, contact.entity)
    );
  }

  /** Feet positions in simulation space. Every directed step retains solid collision. */
  clear(from: Vec2Like, to: Vec2Like, exclude = this.entity): boolean {
    const shape = this.collider.config.shape;
    if (!shape) return false;
    const offset = this.collider.config.offset ?? { x: 0, y: 0 };
    const destination = { x: to.x + offset.x, y: to.y + offset.y };
    const options = {
      filterGroups: this.params.volume,
      excludeEntity: exclude,
    };
    if (
      this.world
        .queryShape(shape, destination, options)
        .some((entity) => entity !== this.entity)
    )
      return false;
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return (
      length < 0.01 ||
      !this.world.castShape(
        shape,
        { x: from.x + offset.x, y: from.y + offset.y },
        { x: dx / length, y: dy / length },
        length,
        { ...options, solidFor: this.collider, stopAtPenetration: false },
      )
    );
  }
}
