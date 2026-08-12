/**
 * @yagejs-addons/steering/physics — the `@yagejs/physics` integration entry.
 * Value-imports physics, so it lives behind this subpath: the root entry
 * stays physics-free and `@yagejs/physics` is an optional peer, needed only
 * by consumers importing from here.
 */
import { Transform, Vec2 } from "@yagejs/core";
import { RigidBodyComponent } from "@yagejs/physics";
import type { PhysicsWorld, RaycastHit } from "@yagejs/physics";
import { SteeringAgent } from "./SteeringAgent.js";
import type { SteeringAgentOptions } from "./SteeringAgent.js";
import { resolve } from "./core/math.js";
import type {
  AgentState,
  Kinematic,
  NeighborsSource,
  SteeringBehavior,
  SteeringOptions,
} from "./core/types.js";

/** A world to query, or a provider resolved per step from the agent. */
export type WorldSource = PhysicsWorld | ((agent: AgentState) => PhysicsWorld);

export type PhysicsSteeringAgentOptions = Omit<SteeringAgentOptions, "body" | "apply">;

/**
 * `SteeringAgent` that drives the entity's own `RigidBodyComponent` — mount
 * it next to a body and collider, nothing to wire. On a dynamic body it
 * defaults to impulse drive, so the agent pushes and is pushed like any
 * other: knockback persists, contacts deflect it, and steering corrects at
 * `maxAcceleration` (default `4 × maxSpeed`); pass `drive: "velocity"` to
 * write the commanded velocity every step instead (full authority). On a
 * kinematic body it writes the `Transform` instead of the body — the physics
 * system takes that pose as the next step's target — so the agent pushes
 * dynamic bodies and is never pushed back; `drive` does not apply there
 * (kinematic bodies ignore `setVelocity`/`applyImpulse`) and throws.
 *
 * Component ordering: `RigidBodyComponent` must be added before the agent —
 * `onAdd` reads the body's type.
 */
export class PhysicsSteeringAgent extends SteeringAgent {
  private readonly explicitDrive: "velocity" | "impulse" | undefined;

  constructor(options: PhysicsSteeringAgentOptions) {
    super({ ...options, drive: options.drive ?? "impulse" });
    this.explicitDrive = options.drive;
    this.body = this.sibling(RigidBodyComponent);
  }

  onAdd(): void {
    const rb = this.entity.tryGet(RigidBodyComponent);
    if (!rb) {
      throw new Error(
        "PhysicsSteeringAgent: no RigidBodyComponent on the entity — add the body (and collider) before the agent",
      );
    }
    if (rb.type === "static") {
      throw new Error(
        "PhysicsSteeringAgent: a static body cannot move — use a dynamic or kinematic body",
      );
    }
    if (rb.type === "kinematic") {
      if (this.explicitDrive !== undefined) {
        throw new Error(
          "PhysicsSteeringAgent: kinematic bodies ignore setVelocity/applyImpulse, so `drive` does not apply — remove it; the agent integrates the Transform instead",
        );
      }
      // Kinematic bodies follow the Transform (the physics system captures it
      // as the next step target), so the output is Transform integration, not
      // a body write.
      this.body = undefined;
      this.drive = "velocity";
    }
  }
}

export interface AvoidCollidersOptions extends SteeringOptions {
  /** Center ray length in px. Default 100. */
  lookAhead?: number;
  /** Angle of the two side whiskers off the heading, radians. Default π/6. */
  whiskerAngle?: number;
  /** Side-whisker length in px. Default `0.7 · lookAhead`; 0 disables whiskers. */
  whiskerLength?: number;
}

/**
 * Obstacle avoidance against the real physics world: raycasts along the
 * heading (a center ray plus two whiskers, so shoulder clips are seen) and
 * steers away from the closest hit, along the hit normal's component
 * perpendicular to the heading. No obstacle list to maintain — tilemap
 * walls, crates, and any other collider all count. The agent's own collider
 * is excluded via `AgentState.entity` (set automatically by
 * `SteeringAgent`). ZERO when stationary or when nothing is in the path.
 * Give it a raised `priority` so it overrides seek instead of out-voting it.
 */
export function avoidColliders(
  world: WorldSource,
  opts: AvoidCollidersOptions = {},
): SteeringBehavior {
  const lookAhead = opts.lookAhead ?? 100;
  const whiskerAngle = opts.whiskerAngle ?? Math.PI / 6;
  const whiskerLength = opts.whiskerLength ?? lookAhead * 0.7;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const heading = agent.velocity.normalize();
      if (heading.lengthSq() === 0) return Vec2.ZERO;

      const physicsWorld = resolve(world, agent);
      const rayOptions = agent.entity ? { excludeEntity: agent.entity } : undefined;
      const rays = [{ direction: heading, length: lookAhead }];
      if (whiskerLength > 0 && whiskerAngle > 0) {
        rays.push(
          { direction: heading.rotate(whiskerAngle), length: whiskerLength },
          { direction: heading.rotate(-whiskerAngle), length: whiskerLength },
        );
      }

      let closest: RaycastHit | null = null;
      for (const ray of rays) {
        const hit = physicsWorld.raycast(agent.position, ray.direction, ray.length, rayOptions);
        if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
      }
      if (!closest) return Vec2.ZERO;

      // Steer laterally: the normal minus its along-heading component. A
      // dead-center flat-wall hit leaves no lateral part — commit to a side.
      let away = closest.normal.sub(heading.scale(closest.normal.dot(heading)));
      if (away.lengthSq() < 1e-12) {
        away = heading.rotate(Math.PI / 2);
      }
      return away.normalize().scale(agent.maxSpeed);
    },
  };
}

export interface PhysicsNeighborsOptions {
  /** Query radius in px around the agent. Default 80. */
  radius?: number;
  /** Rapier interaction groups filter for the query. */
  filterGroups?: number;
}

/**
 * A `NeighborsSource` backed by a world radius query around the agent:
 * every entity with a collider in range becomes a `Kinematic` (Transform
 * position + body velocity; entities without a body count as stationary).
 * The agent itself is excluded via `AgentState.entity`. Feed it to
 * `separation`/`alignment`/`cohesion` — note each behavior resolves its
 * source per step, so three flock rules mean three queries per agent.
 */
export function physicsNeighbors(
  world: WorldSource,
  opts: PhysicsNeighborsOptions = {},
): NeighborsSource {
  const radius = opts.radius ?? 80;
  return (agent) => {
    const physicsWorld = resolve(world, agent);
    const queryOptions = {
      ...(agent.entity ? { excludeEntity: agent.entity } : {}),
      ...(opts.filterGroups !== undefined ? { filterGroups: opts.filterGroups } : {}),
    };
    return physicsWorld.queryRadius(agent.position, radius, queryOptions).map(
      (entity): Kinematic => ({
        position: entity.get(Transform).position,
        velocity: entity.tryGet(RigidBodyComponent)?.getVelocity() ?? Vec2.ZERO,
      }),
    );
  };
}
