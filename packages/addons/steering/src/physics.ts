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

/** A world to query, or a provider resolved per frame from the agent. */
export type WorldSource = PhysicsWorld | ((agent: AgentState) => PhysicsWorld);

export type PhysicsSteeringAgentOptions = Omit<SteeringAgentOptions, "body" | "apply">;

/**
 * `SteeringAgent` that drives the entity's own `RigidBodyComponent` — mount
 * it next to a body and collider, nothing to wire. Defaults to impulse
 * drive, so a dynamic body pushes and is pushed like any other: knockback
 * persists, contacts deflect it, and steering corrects at `maxAcceleration`
 * (default `4 × maxSpeed`). Pass `drive: "velocity"` for full-authority
 * movers (e.g. kinematic velocity-based bodies).
 */
export class PhysicsSteeringAgent extends SteeringAgent {
  constructor(options: PhysicsSteeringAgentOptions) {
    super({ ...options, drive: options.drive ?? "impulse" });
    this.body = this.sibling(RigidBodyComponent);
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
 * source per frame, so three flock rules mean three queries per agent.
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
