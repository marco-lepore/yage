import { Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type {
  AgentState,
  ArriveOptions,
  AvoidObstaclesOptions,
  ContainBounds,
  ContainOptions,
  FleeOptions,
  FlockOptions,
  FollowPathBehavior,
  FollowPathOptions,
  KinematicTarget,
  NeighborsSource,
  Obstacle,
  ObstaclesSource,
  PointTarget,
  PursueOptions,
  SeekOptions,
  SteeringBehavior,
  WanderOptions,
} from "./types.js";
import { clamp, resolve } from "./math.js";

/** Steer straight toward `target` at full speed. ZERO at the target. */
export function seek(target: PointTarget, opts: SeekOptions = {}): SteeringBehavior {
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const t = resolve(target, agent);
      const toTarget = new Vec2(t.x - agent.position.x, t.y - agent.position.y);
      return toTarget.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Steer straight away from `target` at full speed. With `radius` set, only
 * flees when within that distance; omit to always flee. ZERO at the target.
 */
export function flee(target: PointTarget, opts: FleeOptions = {}): SteeringBehavior {
  const radius = opts.radius;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const t = resolve(target, agent);
      const away = new Vec2(agent.position.x - t.x, agent.position.y - t.y);
      if (radius !== undefined && away.length() > radius) return Vec2.ZERO;
      return away.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Seek `target`, ramping speed down linearly inside `slowRadius` and
 * settling to ZERO inside `arriveRadius`. `onArrive`/`onDepart` fire once, in
 * the `compute` call where the agent crosses `arriveRadius`.
 */
export function arrive(target: PointTarget, opts: ArriveOptions = {}): SteeringBehavior {
  const slowRadius = opts.slowRadius ?? 120;
  const arriveRadius = opts.arriveRadius ?? 4;
  let arrived = false;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const t = resolve(target, agent);
      const toTarget = new Vec2(t.x - agent.position.x, t.y - agent.position.y);
      const distance = toTarget.length();

      if (distance < arriveRadius) {
        if (!arrived) {
          arrived = true;
          opts.onArrive?.();
        }
        return Vec2.ZERO;
      }
      if (arrived) {
        arrived = false;
        opts.onDepart?.();
      }

      const speed =
        distance < slowRadius ? agent.maxSpeed * (distance / slowRadius) : agent.maxSpeed;
      return toTarget.normalize().scale(speed);
    },
  };
}

/**
 * Wander in a slowly-turning circle ahead of the agent's heading. `random`
 * is injectable so tests (and the addon's own e2e) can be deterministic.
 */
export function wander(opts: WanderOptions = {}): SteeringBehavior {
  const distance = opts.distance ?? 60;
  const radius = opts.radius ?? 30;
  const jitter = opts.jitter ?? 3;
  const random = opts.random ?? Math.random;
  let angle = 0;
  let lastHeading: Vec2 = Vec2.RIGHT;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent, dt) {
      angle += (random() * 2 - 1) * jitter * dt;

      const heading = agent.velocity.normalize();
      const currentHeading = heading.lengthSq() > 0 ? heading : lastHeading;
      lastHeading = currentHeading;

      const circleCenter = agent.position.add(currentHeading.scale(distance));
      const target = circleCenter.add(Vec2.fromAngle(angle, radius));
      const toTarget = target.sub(agent.position);
      return toTarget.normalize().scale(agent.maxSpeed);
    },
  };
}

function predict(target: KinematicTarget, agent: AgentState, maxPrediction: number): Vec2 {
  const k = resolve(target, agent);
  const targetPos = new Vec2(k.position.x, k.position.y);
  const distance = targetPos.distance(agent.position);
  // maxSpeed 0 (frozen agent) at the target position would divide 0/0.
  const leadTime =
    agent.maxSpeed > 0 ? Math.min(maxPrediction, distance / agent.maxSpeed) : 0;
  return targetPos.add(new Vec2(k.velocity.x, k.velocity.y).scale(leadTime));
}

/**
 * Seek `target`'s predicted future position, leading by up to
 * `maxPrediction` seconds. A stationary target collapses to `seek`.
 */
export function pursue(target: KinematicTarget, opts: PursueOptions = {}): SteeringBehavior {
  const maxPrediction = opts.maxPrediction ?? 1;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const predicted = predict(target, agent, maxPrediction);
      const toTarget = predicted.sub(agent.position);
      return toTarget.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Flee `target`'s predicted future position, leading by up to
 * `maxPrediction` seconds. A stationary target collapses to `flee`.
 */
export function evade(target: KinematicTarget, opts: PursueOptions = {}): SteeringBehavior {
  const maxPrediction = opts.maxPrediction ?? 1;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const predicted = predict(target, agent, maxPrediction);
      const away = agent.position.sub(predicted);
      return away.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Look-ahead obstacle avoidance (not swept collision): casts a ray of
 * length `lookAhead` along the current heading, and steers laterally away
 * from the closest (to the agent) obstacle whose expanded circle
 * (`radius + agentRadius`) crosses that ray. ZERO when stationary (no ray)
 * or when nothing is in the path.
 */
export function avoidObstacles(
  obstacles: ObstaclesSource,
  opts: AvoidObstaclesOptions = {},
): SteeringBehavior {
  const lookAhead = opts.lookAhead ?? 100;
  const agentRadius = opts.agentRadius ?? 0;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const dir = agent.velocity.normalize();
      if (dir.lengthSq() === 0) return Vec2.ZERO;

      let closestObstacle: Obstacle | undefined;
      let closestAhead: Vec2 = Vec2.ZERO;
      let closestDistance = Infinity;

      for (const obstacle of resolve(obstacles, agent)) {
        const obstaclePos = new Vec2(obstacle.position.x, obstacle.position.y);
        const toObstacle = obstaclePos.sub(agent.position);
        const projection = toObstacle.dot(dir);
        if (projection < 0) continue; // behind the agent — not in the ray's path
        const t = clamp(projection, 0, lookAhead);
        const ahead = agent.position.add(dir.scale(t));
        const threatRadius = obstacle.radius + agentRadius;
        if (ahead.distance(obstaclePos) > threatRadius) continue;

        const distanceToAgent = obstaclePos.distance(agent.position);
        if (distanceToAgent < closestDistance) {
          closestDistance = distanceToAgent;
          closestObstacle = obstacle;
          closestAhead = ahead;
        }
      }

      if (!closestObstacle) return Vec2.ZERO;
      const obstaclePos = new Vec2(closestObstacle.position.x, closestObstacle.position.y);
      let away = closestAhead.sub(obstaclePos);
      if (away.lengthSq() === 0) {
        // Obstacle center sits exactly on the ray: the ahead-point minus
        // obstacle-center offset is degenerate. Break the tie with a fixed
        // perpendicular so the agent still commits to a side.
        away = dir.rotate(Math.PI / 2);
      }
      return away.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Push away from every neighbor within `radius`, weighted by inverse
 * distance (closer neighbors push harder). ZERO with no neighbor in range;
 * symmetric neighbors cancel to ZERO.
 */
export function separation(neighbors: NeighborsSource, opts: FlockOptions = {}): SteeringBehavior {
  const radius = opts.radius ?? 40;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      let sum: Vec2 = Vec2.ZERO;
      for (const neighbor of resolve(neighbors, agent)) {
        const neighborPos = new Vec2(neighbor.position.x, neighbor.position.y);
        const away = agent.position.sub(neighborPos);
        const distance = away.length();
        if (distance === 0 || distance > radius) continue;
        sum = sum.add(away.normalize().scale(1 / distance));
      }
      if (sum.lengthSq() === 0) return Vec2.ZERO;
      return sum.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Match the mean velocity of every neighbor within `radius`. ZERO with no
 * neighbor in range.
 */
export function alignment(neighbors: NeighborsSource, opts: FlockOptions = {}): SteeringBehavior {
  const radius = opts.radius ?? 80;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      let sum: Vec2 = Vec2.ZERO;
      let count = 0;
      for (const neighbor of resolve(neighbors, agent)) {
        const neighborPos = new Vec2(neighbor.position.x, neighbor.position.y);
        if (neighborPos.distance(agent.position) > radius) continue;
        sum = sum.add(neighbor.velocity);
        count++;
      }
      if (count === 0) return Vec2.ZERO;
      return sum.scale(1 / count).normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Seek the centre of mass of every neighbor within `radius`. ZERO with no
 * neighbor in range.
 */
export function cohesion(neighbors: NeighborsSource, opts: FlockOptions = {}): SteeringBehavior {
  const radius = opts.radius ?? 80;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      let sum: Vec2 = Vec2.ZERO;
      let count = 0;
      for (const neighbor of resolve(neighbors, agent)) {
        const neighborPos = new Vec2(neighbor.position.x, neighbor.position.y);
        if (neighborPos.distance(agent.position) > radius) continue;
        sum = sum.add(neighborPos);
        count++;
      }
      if (count === 0) return Vec2.ZERO;
      const center = sum.scale(1 / count);
      const toCenter = center.sub(agent.position);
      return toCenter.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Visit `waypoints` in order: full speed toward the current one, advancing
 * when within `waypointRadius`. With `loop`, wraps forever (patrol);
 * without, the final waypoint gets `arrive` semantics (slow-down ramp,
 * settle, `onArrive`/`onDepart`). Takes plain points — a pathfinding
 * result's waypoints feed it directly, as does any hand-authored route.
 * Waypoint progress lives in the behavior: to follow a new path, swap in a
 * new `followPath`; to save/restore progress, snapshot `waypointIndex` and
 * pass it back as `startAt`.
 */
export function followPath(
  waypoints: readonly Vec2Like[],
  opts: FollowPathOptions = {},
): FollowPathBehavior {
  const waypointRadius = opts.waypointRadius ?? 16;
  const loop = opts.loop ?? false;
  const slowRadius = opts.slowRadius ?? 120;
  const arriveRadius = opts.arriveRadius ?? 4;
  // "nearest" resolves on the first evaluate, when the agent position is known.
  let index = typeof opts.startAt === "number" ? Math.max(0, opts.startAt) : 0;
  let pickNearest = opts.startAt === "nearest";
  let arrived = false;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    get waypointIndex() {
      return index;
    },
    evaluate(agent) {
      if (waypoints.length === 0) return Vec2.ZERO;
      if (pickNearest) {
        pickNearest = false;
        let best = 0;
        for (let i = 1; i < waypoints.length; i++) {
          const wp = waypoints[i]!;
          const bestWp = waypoints[best]!;
          if (
            Vec2.distance(agent.position, wp) < Vec2.distance(agent.position, bestWp)
          ) {
            best = i;
          }
        }
        index = best;
      }

      let wp = waypoints[Math.min(index, waypoints.length - 1)]!;
      let toTarget = new Vec2(wp.x - agent.position.x, wp.y - agent.position.y);
      const isLast = !loop && index >= waypoints.length - 1;

      if (!isLast && toTarget.length() < waypointRadius) {
        index = loop ? (index + 1) % waypoints.length : index + 1;
        wp = waypoints[Math.min(index, waypoints.length - 1)]!;
        toTarget = new Vec2(wp.x - agent.position.x, wp.y - agent.position.y);
      }

      if (!loop && index >= waypoints.length - 1) {
        const distance = toTarget.length();
        if (distance < arriveRadius) {
          if (!arrived) {
            arrived = true;
            opts.onArrive?.();
          }
          return Vec2.ZERO;
        }
        if (arrived) {
          arrived = false;
          opts.onDepart?.();
        }
        const speed =
          distance < slowRadius ? agent.maxSpeed * (distance / slowRadius) : agent.maxSpeed;
        return toTarget.normalize().scale(speed);
      }

      return toTarget.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Steer back inside `bounds` when the look-ahead point would leave it.
 * Violated axes steer inward at full strength; the other axis keeps the
 * current heading, so the agent banks along the edge instead of bouncing.
 * ZERO while safely inside.
 */
export function contain(bounds: ContainBounds, opts: ContainOptions = {}): SteeringBehavior {
  const lookAhead = opts.lookAhead ?? 60;
  return {
    weight: opts.weight ?? 1,
    priority: opts.priority ?? 0,
    evaluate(agent) {
      const heading = agent.velocity.normalize();
      const ahead = agent.position.add(heading.scale(lookAhead));

      let dx = 0;
      let dy = 0;
      if (ahead.x < bounds.x) dx = 1;
      else if (ahead.x > bounds.x + bounds.width) dx = -1;
      if (ahead.y < bounds.y) dy = 1;
      else if (ahead.y > bounds.y + bounds.height) dy = -1;
      if (dx === 0 && dy === 0) return Vec2.ZERO;

      const inward = new Vec2(dx !== 0 ? dx : heading.x, dy !== 0 ? dy : heading.y);
      return inward.normalize().scale(agent.maxSpeed);
    },
  };
}
