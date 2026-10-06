import { tuningNumbers } from "../core/validate.js";
import { Component, type Vec2Like } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
  type PhysicsWorld,
} from "@yagejs/physics";
import type { GroundProbe } from "./GroundProbe.js";

export interface TerrainRequest {
  readonly grounded: boolean;
  readonly direction: number;
  readonly allowStep: boolean;
}

export interface TerrainTuning {
  readonly groundSnapDistance: number;
  readonly ledgeStepHeight: number;
  readonly ledgeMinWidth: number;
  readonly groundPressSpeed: number;
  readonly groundedRiseTolerance: number;
}

/** Geometry only. MotionReconciler owns application and movement-claim arbitration. */
export class TerrainAssist extends Component {
  private world!: PhysicsWorld;
  private body!: RigidBodyComponent;
  private collider!: ColliderComponent;

  constructor(
    private readonly params: {
      ground: GroundProbe;
      tuning: TerrainTuning;
      solid: number;
      volume: number;
    },
  ) {
    super();
    tuningNumbers("TerrainAssist", params.tuning);
    this.params = { ...params, tuning: Object.freeze({ ...params.tuning }) };
  }

  onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.body = this.entity.get(RigidBodyComponent);
    this.collider = this.entity.get(ColliderComponent);
  }

  correct(
    request: TerrainRequest,
    velocity: Vec2Like,
    dt: number,
  ): {
    velocity: Vec2Like;
    offset?: Vec2Like;
  } {
    const { tuning, ground } = this.params;
    const origin = this.origin();
    const dx = velocity.x * dt;
    // Step eligibility is geometric forgiveness around the feet, not a climb.
    // Fast falls cannot acquire a ledge; rising jumps keep their existing rise.
    if (
      request.allowStep &&
      request.direction * dx > 0 &&
      velocity.y <= tuning.groundedRiseTolerance
    ) {
      const step = this.step(origin, dx);
      if (step)
        return {
          offset: step,
          velocity: { x: velocity.x, y: Math.min(velocity.y, 0) },
        };
    }
    // Running into a steep ramp must not turn horizontal drive into climbing.
    const barrier = this.cast(
      origin,
      { x: Math.sign(dx) || 1, y: 0 },
      Math.abs(dx),
      this.params.volume,
    );
    if (
      barrier &&
      barrier.normal.y < -0.05 &&
      !this.walkable(barrier.normal) &&
      velocity.y >= -tuning.groundedRiseTolerance
    )
      return { velocity: { x: 0, y: velocity.y } };
    if (!request.grounded) return { velocity };

    const normal = ground.normal;
    // Keep the authored horizontal speed along a ramp. The normal press is
    // removed by the solver and carries no tangential downhill acceleration.
    const tangentY = (-normal.x / normal.y) * velocity.x;
    const seated = {
      x: velocity.x - normal.x * tuning.groundPressSpeed,
      y: tangentY - normal.y * tuning.groundPressSpeed,
    };
    const down = this.cast(
      origin,
      { x: 0, y: 1 },
      tuning.groundSnapDistance,
      this.params.solid,
    );
    // Never pull a jump down: request.grounded has already classified departure,
    // and each winning move must explicitly permit ground following.
    if (
      down &&
      this.walkable(down.normal) &&
      down.point.y >= this.body.positionY - 0.5
    ) {
      // Flat tops and ramp crests need a small clearance so CCD does not
      // catch an adjoining vertical face. Downward press would consume that gap.
      if (Math.abs(down.normal.x) < 0.001) {
        const correction = down.distance - 0.5;
        if (
          correction >= 0 ||
          !this.cast(origin, { x: 0, y: -1 }, -correction, this.params.volume)
        )
          return {
            velocity: { x: velocity.x, y: 0 },
            ...(Math.abs(correction) > 0.01
              ? { offset: { x: 0, y: correction } }
              : {}),
          };
      }
      if (down.distance > 0.05)
        return { velocity: seated, offset: { x: 0, y: down.distance } };
    }
    return { velocity: seated };
  }

  private origin(): Vec2Like {
    const offset = this.collider.config.offset;
    return {
      x: this.body.positionX + (offset?.x ?? 0),
      y: this.body.positionY + (offset?.y ?? 0),
    };
  }

  /** Rapier's autostep sequence: obstruction, up clearance, forward clearance, down support. */
  private step(origin: Vec2Like, dx: number): Vec2Like | undefined {
    const { tuning, volume } = this.params;
    if (tuning.ledgeStepHeight <= 0 || tuning.ledgeMinWidth <= 0) return;
    const direction = { x: Math.sign(dx), y: 0 };
    const obstruction = this.cast(origin, direction, Math.abs(dx), volume);
    // A touching ramp corner may report the slope normal even when CCD
    // blocks its adjoining face. The clearance sequence also handles that lip.
    if (
      !obstruction ||
      (this.walkable(obstruction.normal) && obstruction.distance > 0.05) ||
      Math.abs(obstruction.normal.x) < 0.05
    )
      return;
    // A dynamic body may rest slightly inside support. This geometric margin
    // covers solver penetration, not an extra authored step height.
    const height = tuning.ledgeStepHeight + 0.5;
    if (this.cast(origin, { x: 0, y: -1 }, height, volume)) return;
    const raised = { x: origin.x, y: origin.y - height };
    const width = Math.max(tuning.ledgeMinWidth, Math.abs(dx));
    if (this.cast(raised, direction, width, volume)) return;
    const ahead = { x: raised.x + direction.x * width, y: raised.y };
    // Volume excludes one-way platforms: an airborne player below one must
    // pass through, never get hauled onto its top by assistance.
    const landing = this.cast(ahead, { x: 0, y: 1 }, height, volume);
    if (!landing || !this.walkable(landing.normal)) return;
    const lift = height - landing.distance;
    if (lift < -0.05 || lift > height) return;
    const destination = { x: raised.x, y: raised.y + landing.distance };
    // A forward landing probe may reach past a narrow obstruction. Validate the
    // actual destination too, rather than assuming its support has the same height.
    if (
      this.cast(
        { x: destination.x, y: raised.y },
        { x: 0, y: 1 },
        landing.distance - 0.05,
        volume,
      )
    )
      return;
    // Leave clearance above the riser so CCD does not keep catching its face.
    return { x: 0, y: -Math.min(height, lift + 0.5) };
  }

  private walkable(normal: Vec2Like): boolean {
    return this.params.ground.isWalkable(normal);
  }

  private cast(
    origin: Vec2Like,
    direction: Vec2Like,
    distance: number,
    filterGroups: number,
  ) {
    const shape = this.collider.config.shape;
    if (!shape || distance <= 0) return null;
    return this.world.castShape(shape, origin, direction, distance, {
      filterGroups,
      excludeEntity: this.entity,
      solidFor: this.collider,
      stopAtPenetration: false,
    });
  }
}
