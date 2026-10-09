import { interactionGroup, tuningNumbers } from "../core/validate.js";
import { Component } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
  type ColliderShape,
  type PhysicsWorld,
} from "@yagejs/physics";

const HEADROOM_INSET = 2;

export interface StanceTuning {
  /** Collider height while crouched, px. */
  readonly crouchedHeight: number;
  /** Which colliders block standing up, as an interaction group. */
  readonly filterGroups: number;
}

export class Stance extends Component {
  private readonly tuning: StanceTuning;
  private world!: PhysicsWorld;
  private body!: RigidBodyComponent;
  private collider!: ColliderComponent;
  private standing!: ColliderShape & { type: "box" };
  private crouchedShape!: ColliderShape;
  private headroom!: { shape: ColliderShape; above: number };
  private _crouched = false;

  constructor(params: { tuning: StanceTuning }) {
    super();
    const { filterGroups, ...numbers } = params.tuning;
    tuningNumbers("Stance", numbers);
    interactionGroup("Stance", "filterGroups", filterGroups);
    this.tuning = Object.freeze({ ...params.tuning });
  }

  onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.body = this.entity.get(RigidBodyComponent);
    this.collider = this.entity.get(ColliderComponent);
    const shape = this.collider.config.shape;
    if (shape?.type !== "box")
      throw new Error("Stance needs the standing collider to be a box.");
    this.standing = shape;

    const { width, height } = shape;
    const crouched = this.tuning.crouchedHeight;
    if (width <= 4 || crouched <= 0 || crouched >= height)
      throw new Error(
        "Stance: require width > 4 and 0 < crouchedHeight < standing height",
      );
    // In the collider's frame, whose origin is the standing box's centre and
    // whose y grows downward: the bottom edge is at +height/2.
    const bottom = height / 2;
    this.crouchedShape = {
      type: "polygon",
      vertices: [
        { x: -width / 2, y: bottom - crouched },
        { x: width / 2, y: bottom - crouched },
        { x: width / 2, y: bottom },
        { x: -width / 2, y: bottom },
      ],
    };
    // The space standing adds, placed by its centre above the feet.
    this.headroom = {
      shape: {
        type: "box",
        width: width - 2 * HEADROOM_INSET,
        height: height - crouched,
      },
      above: (height + crouched) / 2,
    };
  }

  get crouched(): boolean {
    return this._crouched;
  }

  /** Whether the space above the crouched height is clear of terrain right now. */
  get canStand(): boolean {
    const hits = this.world.queryShape(
      this.headroom.shape,
      { x: this.body.positionX, y: this.body.positionY - this.headroom.above },
      { filterGroups: this.tuning.filterGroups, excludeEntity: this.entity },
    );
    return hits.length === 0;
  }

  crouch(): void {
    if (this._crouched) return;
    this._crouched = true;
    this.collider.setShape(this.crouchedShape);
  }

  /** The caller checks `canStand` first; growing into terrain leaves the body inside it. */
  stand(): void {
    if (!this._crouched) return;
    this._crouched = false;
    this.collider.setShape(this.standing);
  }
}
