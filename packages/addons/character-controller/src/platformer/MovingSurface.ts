import { finite } from "../core/validate.js";
import { CrushProbe } from "./CrushProbe.js";
import { Component, GameLoopKey, Transform, type Vec2Like } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";

/** Publishes the next translation before riders update. Spawn surfaces before riders. */
export class MovingSurface extends Component {
  private body!: RigidBodyComponent;
  private transform!: Transform;
  private travel = 0;
  private readonly nextVelocity = { x: 0, y: 0 };

  get velocity(): Readonly<Vec2Like> {
    return this.nextVelocity;
  }

  onDisable(): void {
    this.nextVelocity.x = 0;
    this.nextVelocity.y = 0;
  }

  constructor(
    private readonly path: { from: Vec2Like; to: Vec2Like; speed: number },
  ) {
    super();
    for (const [key, point] of [
      ["from", path.from],
      ["to", path.to],
    ] as const) {
      finite("MovingSurface", `${key}.x`, point.x);
      finite("MovingSurface", `${key}.y`, point.y);
    }
    finite("MovingSurface", "speed", path.speed, 0);
    finite(
      "MovingSurface",
      "path length",
      Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y),
    );
    this.path = {
      from: { ...path.from },
      to: { ...path.to },
      speed: path.speed,
    };
  }

  onAdd(): void {
    this.body = this.entity.get(RigidBodyComponent);
    this.transform = this.entity.get(Transform);
    if (this.body.type !== "kinematic")
      throw new Error("MovingSurface: body must be kinematic");
  }

  fixedUpdate(dt: number): void {
    finite("MovingSurface.fixedUpdate", "dt", dt, 0);
    if (dt <= 0) {
      this.nextVelocity.x = 0;
      this.nextVelocity.y = 0;
      return;
    }
    const { from, to, speed } = this.path;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) return;
    const travel = this.travel + speed * dt;
    finite("MovingSurface.fixedUpdate", "travel", travel, 0);
    this.travel = travel % (2 * length);
    const fraction = Math.min(this.travel, 2 * length - this.travel) / length;
    const x = from.x + (to.x - from.x) * fraction;
    const y = from.y + (to.y - from.y) * fraction;
    // Kinematic targets are consumed over one physics step, independent of
    // the entity's component clock.
    const physicsDt = this.use(GameLoopKey).fixedTimestep;
    const vx = (x - this.body.positionX) / physicsDt;
    const vy = (y - this.body.positionY) / physicsDt;
    finite("MovingSurface.fixedUpdate", "velocity.x", vx);
    finite("MovingSurface.fixedUpdate", "velocity.y", vy);
    this.nextVelocity.x = vx;
    this.nextVelocity.y = vy;
    // Broad phase only: the receiver checks its actual stance and escape path.
    // Crush geometry supports translating boxes.
    const collider = this.entity.get(ColliderComponent);
    const shape = collider.config.shape;
    if (shape?.type === "box") {
      const dx = x - this.body.positionX,
        dy = y - this.body.positionY;
      const offset = collider.config.offset ?? { x: 0, y: 0 };
      const candidates = this.use(PhysicsWorldKey).queryShape(
        {
          type: "box",
          width: shape.width + Math.abs(dx),
          height: shape.height + Math.abs(dy),
        },
        {
          x: this.body.positionX + offset.x + dx / 2,
          y: this.body.positionY + offset.y + dy / 2,
        },
        {
          excludeEntity: this.entity,
        },
      );
      for (const entity of candidates)
        entity.tryGet(CrushProbe)?.consider(collider, { x: dx, y: dy });
    }
    this.transform.setWorldPosition(x, y);
  }
}
