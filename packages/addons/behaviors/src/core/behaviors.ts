import { Vec2 } from "@yagejs/core";
import type {
  ArriveOptions,
  AvoidObstaclesOptions,
  FleeOptions,
  FlockOptions,
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
    evaluate(agent) {
      const t = resolve(target);
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
    evaluate(agent) {
      const t = resolve(target);
      const away = new Vec2(agent.position.x - t.x, agent.position.y - t.y);
      if (radius !== undefined && away.length() > radius) return Vec2.ZERO;
      return away.normalize().scale(agent.maxSpeed);
    },
  };
}

/**
 * Seek `target`, ramping speed down linearly inside `slowRadius` and
 * settling to ZERO inside `arriveRadius`. `onArrive`/`onDepart` fire once on
 * the frame the agent crosses `arriveRadius`.
 */
export function arrive(target: PointTarget, opts: ArriveOptions = {}): SteeringBehavior {
  const slowRadius = opts.slowRadius ?? 120;
  const arriveRadius = opts.arriveRadius ?? 4;
  let arrived = false;
  return {
    weight: opts.weight ?? 1,
    evaluate(agent) {
      const t = resolve(target);
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

function predict(target: KinematicTarget, agent: { position: Vec2; maxSpeed: number }, maxPrediction: number): Vec2 {
  const k = resolve(target);
  const targetPos = new Vec2(k.position.x, k.position.y);
  const distance = targetPos.distance(agent.position);
  const leadTime = Math.min(maxPrediction, distance / agent.maxSpeed);
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
    evaluate(agent) {
      const dir = agent.velocity.normalize();
      if (dir.lengthSq() === 0) return Vec2.ZERO;

      let closestObstacle: Obstacle | undefined;
      let closestAhead: Vec2 = Vec2.ZERO;
      let closestDistance = Infinity;

      for (const obstacle of resolve(obstacles)) {
        const obstaclePos = new Vec2(obstacle.position.x, obstacle.position.y);
        const toObstacle = obstaclePos.sub(agent.position);
        const t = clamp(toObstacle.dot(dir), 0, lookAhead);
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
    evaluate(agent) {
      let sum: Vec2 = Vec2.ZERO;
      for (const neighbor of resolve(neighbors)) {
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
    evaluate(agent) {
      let sum: Vec2 = Vec2.ZERO;
      let count = 0;
      for (const neighbor of resolve(neighbors)) {
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
    evaluate(agent) {
      let sum: Vec2 = Vec2.ZERO;
      let count = 0;
      for (const neighbor of resolve(neighbors)) {
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
