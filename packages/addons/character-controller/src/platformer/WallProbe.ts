import { tuningNumbers } from "../core/validate.js";
import { Component } from "@yagejs/core";
import {
  PhysicsWorldKey,
  RigidBodyComponent,
  type PhysicsWorld,
} from "@yagejs/physics";

/** Thin enough to describe the wall beside the body rather than the floor under it. */
const PROBE_THICKNESS = 2;

export interface WallProbeTuning {
  /** Half the body's width, px. The cast starts at the body's side, as the ground probe's starts at its feet. */
  readonly halfWidth: number;
  /**
   * How tall a vertical surface has to be to count as a wall, px. Shorter than
   * the body, so a floor or a ceiling is not one; taller than a platform's lip,
   * so a ledge is not one either.
   */
  readonly height: number;
  /** How far up from the feet the cast is centred, px. */
  readonly centreY: number;
  /** How far to each side it looks, px. */
  readonly distance: number;
  /** Which colliders count as wall, as an interaction group. See `GroundProbe`. */
  readonly filterGroups: number;
}

export class WallProbe extends Component {
  private readonly tuning: WallProbeTuning;
  private world!: PhysicsWorld;
  private body!: RigidBodyComponent;
  private _side: -1 | 0 | 1 = 0;

  constructor(params: { tuning: WallProbeTuning }) {
    super();
    tuningNumbers("WallProbe", params.tuning);
    this.tuning = Object.freeze({ ...params.tuning });
  }

  onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.body = this.entity.get(RigidBodyComponent);
  }

  get side(): -1 | 0 | 1 {
    return this._side;
  }

  fixedUpdate(): void {
    this._side = this.hits(-1) ? -1 : this.hits(1) ? 1 : 0;
  }

  private hits(towards: -1 | 1): boolean {
    // The body origin is the feet, so the band is centred up the body from
    // there, and offset sideways until its outer edge sits on the body's own —
    // `distance` is then measured from the body's side rather than its middle.
    const x =
      this.body.positionX +
      towards * (this.tuning.halfWidth - PROBE_THICKNESS / 2);
    const y = this.body.positionY - this.tuning.centreY;
    const reach = this.tuning.height / 2 - PROBE_THICKNESS / 2;
    return this.face(x, y - reach, towards) && this.face(x, y + reach, towards);
  }

  private face(x: number, y: number, towards: -1 | 1): boolean {
    const hit = this.world.castShape(
      { type: "box", width: PROBE_THICKNESS, height: PROBE_THICKNESS },
      { x, y },
      { x: towards, y: 0 },
      this.tuning.distance,
      { filterGroups: this.tuning.filterGroups, excludeEntity: this.entity },
    );
    // A wall faces sideways. A body resting on the floor starts the cast close
    // enough to it that a shallow slope would answer, and anything shallower
    // than 45° is ground rather than wall — the mirror of the test
    // `GroundProbe` makes, and the reason a floor never reads as a wall.
    return hit !== null && Math.abs(hit.normal.x) > Math.abs(hit.normal.y);
  }
}
