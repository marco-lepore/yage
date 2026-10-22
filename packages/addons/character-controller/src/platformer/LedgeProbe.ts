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
  /** Height of the hands above the feet while hanging, px. */
  readonly ledgeHandHeight: number;
  /** How far past the body's side a ledge can be caught, px. */
  readonly ledgeGrabReach: number;
  /** How far above or below the hands the ledge top may be, px. */
  readonly ledgeGrabTolerance: number;
}

export interface LedgeContact {
  readonly entity: Entity;
  readonly body: RigidBodyComponent;
  readonly side: -1 | 1;
  readonly localX: number;
  readonly localY: number;
}

/** Feet positions for each stage of a climb: hanging, raised to the top, standing on it. */
export interface LedgePoints {
  readonly hang: Vec2Like;
  readonly raised: Vec2Like;
  readonly stand: Vec2Like;
}

/**
 * Measures a flat ledge top, its outside face, and the standing body's
 * clearance along a climb. Every query is made as the character's own
 * collider, so a ledge is something the character would collide with. The
 * standing collider must be a box.
 */
export class LedgeProbe extends Component {
  private readonly tuning: LedgeTuning;
  private world!: PhysicsWorld;
  private body!: RigidBodyComponent;
  private collider!: ColliderComponent;
  private halfWidth = 0;

  constructor(params: { tuning: LedgeTuning }) {
    super();
    tuningNumbers("LedgeProbe", params.tuning);
    this.tuning = Object.freeze({ ...params.tuning });
  }

  onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.body = this.entity.get(RigidBodyComponent);
    this.collider = this.entity.get(ColliderComponent);
    const shape = this.collider.config.shape;
    if (shape?.type !== "box")
      throw new Error("LedgeProbe needs the standing collider to be a box.");
    this.halfWidth = shape.width / 2;
  }

  /** A reachable ledge on `side` with a clear climb, or `undefined`. */
  find(side: -1 | 1): LedgeContact | undefined {
    const tuning = this.tuning;
    const reach = this.halfWidth + tuning.ledgeGrabReach;
    const handY = this.body.positionY - tuning.ledgeHandHeight;
    const options = { solidFor: this.collider };
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

  /** The climb points for `contact`, predicted `dt` seconds ahead on a moving ledge. */
  points(contact: LedgeContact, dt = 0): LedgePoints {
    const surface = contact.entity.tryGet(MovingSurface);
    const x =
      contact.body.positionX +
      contact.localX +
      (surface?.velocity.x ?? contact.body.velocityX) * dt;
    const y =
      contact.body.positionY +
      contact.localY +
      (surface?.velocity.y ?? contact.body.velocityY) * dt;
    const outside = x - contact.side * (this.halfWidth + 1);
    return {
      hang: { x: outside, y: y + this.tuning.ledgeHandHeight },
      raised: { x: outside, y: y - 0.75 },
      stand: {
        x: x + contact.side * (this.halfWidth + 2),
        y: y - 0.75,
      },
    };
  }

  /** Whether one climb step from `from` to `to` stays clear while the ledge moves for `dt`. */
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

  /**
   * Whether the standing body fits at `to` and can sweep there from `from`.
   * Feet positions in simulation space. `ignore` skips one entity, such as
   * the ledge the body is following.
   */
  clear(from: Vec2Like, to: Vec2Like, ignore?: Entity): boolean {
    const shape = this.collider.config.shape;
    if (!shape) return false;
    const offset = this.collider.config.offset ?? { x: 0, y: 0 };
    const destination = { x: to.x + offset.x, y: to.y + offset.y };
    const options = {
      solidFor: this.collider,
      ...(ignore ? { excludeEntity: ignore } : {}),
    };
    if (this.world.queryShape(shape, destination, options).length > 0)
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
        { ...options, stopAtPenetration: false },
      )
    );
  }
}
