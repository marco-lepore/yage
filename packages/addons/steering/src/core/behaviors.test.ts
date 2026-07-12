import { describe, expect, it, vi } from "vitest";
import { Vec2 } from "@yagejs/core";
import {
  alignment,
  arrive,
  avoidObstacles,
  cohesion,
  contain,
  evade,
  flee,
  followPath,
  pursue,
  seek,
  separation,
  wander,
} from "./behaviors.js";
import type { AgentState, Kinematic, Obstacle } from "./types.js";

function agent(
  position: Vec2,
  velocity: Vec2 = Vec2.ZERO,
  maxSpeed = 100,
): AgentState {
  return { position, velocity, maxSpeed };
}

describe("seek", () => {
  it("points toward the target with magnitude maxSpeed", () => {
    const behavior = seek(new Vec2(0, 100));
    const result = behavior.evaluate(agent(Vec2.ZERO, Vec2.ZERO, 50), 1 / 60);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(50);
  });

  it("returns ZERO at the target", () => {
    const behavior = seek(new Vec2(10, 10));
    const result = behavior.evaluate(agent(new Vec2(10, 10)), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });

  it("resolves a live provider each call", () => {
    let x = 50;
    const behavior = seek(() => new Vec2(x, 0));
    expect(behavior.evaluate(agent(Vec2.ZERO), 1 / 60).x).toBeGreaterThan(0);
    x = -50;
    expect(behavior.evaluate(agent(Vec2.ZERO), 1 / 60).x).toBeLessThan(0);
  });
});

describe("flee", () => {
  it("points away from the target with magnitude maxSpeed", () => {
    const behavior = flee(new Vec2(0, 100));
    const result = behavior.evaluate(agent(Vec2.ZERO, Vec2.ZERO, 50), 1 / 60);
    expect(result.y).toBeCloseTo(-50);
  });

  it("radius gate: ZERO outside radius, flees inside it", () => {
    const behavior = flee(new Vec2(0, 0), { radius: 50 });
    const far = behavior.evaluate(agent(new Vec2(0, 200)), 1 / 60);
    expect(far).toEqual(Vec2.ZERO);

    const near = behavior.evaluate(agent(new Vec2(0, 20)), 1 / 60);
    expect(near.y).toBeGreaterThan(0);
  });

  it("returns ZERO at the target", () => {
    const behavior = flee(new Vec2(5, 5));
    const result = behavior.evaluate(agent(new Vec2(5, 5)), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });
});

describe("arrive", () => {
  it("moves at full speed outside slowRadius", () => {
    const behavior = arrive(new Vec2(1000, 0), { slowRadius: 100 });
    const result = behavior.evaluate(agent(Vec2.ZERO, Vec2.ZERO, 80), 1 / 60);
    expect(result.length()).toBeCloseTo(80);
  });

  it("ramps speed down monotonically as distance shrinks inside slowRadius", () => {
    const behavior = arrive(new Vec2(200, 0), { slowRadius: 100, arriveRadius: 4 });
    const far = behavior.evaluate(agent(new Vec2(120, 0), Vec2.ZERO, 100), 1 / 60);
    const mid = behavior.evaluate(agent(new Vec2(150, 0), Vec2.ZERO, 100), 1 / 60);
    const near = behavior.evaluate(agent(new Vec2(180, 0), Vec2.ZERO, 100), 1 / 60);
    expect(far.length()).toBeGreaterThan(mid.length());
    expect(mid.length()).toBeGreaterThan(near.length());
  });

  it("returns ZERO inside arriveRadius", () => {
    const behavior = arrive(new Vec2(0, 0), { arriveRadius: 4 });
    const result = behavior.evaluate(agent(new Vec2(1, 0)), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });

  it("fires onArrive exactly once on entering and onDepart exactly once on leaving", () => {
    const onArrive = vi.fn();
    const onDepart = vi.fn();
    const behavior = arrive(new Vec2(0, 0), { arriveRadius: 4, onArrive, onDepart });

    // Outside, then crossing in twice in a row — onArrive fires once.
    behavior.evaluate(agent(new Vec2(10, 0)), 1 / 60);
    behavior.evaluate(agent(new Vec2(2, 0)), 1 / 60);
    behavior.evaluate(agent(new Vec2(1, 0)), 1 / 60);
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onDepart).not.toHaveBeenCalled();

    // Leaving, then staying out twice — onDepart fires once.
    behavior.evaluate(agent(new Vec2(10, 0)), 1 / 60);
    behavior.evaluate(agent(new Vec2(20, 0)), 1 / 60);
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onDepart).toHaveBeenCalledTimes(1);
  });
});

describe("wander", () => {
  it("stays a maxSpeed-magnitude vector, varies call-to-call, and is reproducible for a fixed seed", () => {
    const seedA = deterministicRandom([0.9, 0.1, 0.5, 0.7]);
    const seedB = deterministicRandom([0.9, 0.1, 0.5, 0.7]);
    const behaviorA = wander({ random: seedA });
    const behaviorB = wander({ random: seedB });

    const a1 = behaviorA.evaluate(agent(Vec2.ZERO, new Vec2(1, 0), 100), 1 / 60);
    const a2 = behaviorA.evaluate(agent(Vec2.ZERO, new Vec2(1, 0), 100), 1 / 60);
    const b1 = behaviorB.evaluate(agent(Vec2.ZERO, new Vec2(1, 0), 100), 1 / 60);

    expect(a1.length()).toBeCloseTo(100);
    expect(a2.length()).toBeCloseTo(100);
    expect(a1.equals(a2)).toBe(false); // varies call-to-call
    expect(a1.equals(b1)).toBe(true); // reproducible for the same seed sequence
  });

  it("uses agent.velocity as heading when moving, falls back to the last heading when stationary", () => {
    const random = deterministicRandom([0.5, 0.5, 0.5]);
    const behavior = wander({ random, jitter: 0 });
    // Moving DOWN (+y) — deliberately not the Vec2.RIGHT initial fallback,
    // so a stationary frame distinguishes "kept the last heading" from
    // "reset to the default".
    const moving = behavior.evaluate(agent(Vec2.ZERO, new Vec2(0, 1), 100), 1 / 60);
    const stationary = behavior.evaluate(agent(Vec2.ZERO, Vec2.ZERO, 100), 1 / 60);
    expect(moving.length()).toBeCloseTo(100);
    expect(stationary.length()).toBeCloseTo(100);
    // Circle center 60px along the kept +y heading, offset radius 30 at
    // angle 0 (+x): the steer must point dominantly downward, not along +x.
    expect(stationary.y).toBeGreaterThan(stationary.x);
    expect(stationary.y).toBeGreaterThan(50);
  });
});

describe("pursue / evade", () => {
  function movingTarget(): Kinematic {
    return { position: new Vec2(100, 0), velocity: new Vec2(0, 50) };
  }

  it("pursue leads a moving target: desired points beyond its current position", () => {
    const behavior = pursue(movingTarget());
    const result = behavior.evaluate(agent(Vec2.ZERO, Vec2.ZERO, 100), 1 / 60);
    // Straight seek of (100, 0) would have y = 0; leading the target should
    // tilt the direction toward its travel (+y).
    expect(result.y).toBeGreaterThan(0);
  });

  it("evade flees a moving target's predicted position", () => {
    const behavior = evade(movingTarget());
    const result = behavior.evaluate(agent(Vec2.ZERO, Vec2.ZERO, 100), 1 / 60);
    expect(result.x).toBeLessThan(0);
  });

  it("maxPrediction caps the lead", () => {
    const fastTarget: Kinematic = { position: new Vec2(100, 0), velocity: new Vec2(0, 1000) };
    const capped = pursue(fastTarget, { maxPrediction: 0.1 }).evaluate(
      agent(Vec2.ZERO, Vec2.ZERO, 100),
      1 / 60,
    );
    const uncapped = pursue(fastTarget, { maxPrediction: 5 }).evaluate(
      agent(Vec2.ZERO, Vec2.ZERO, 100),
      1 / 60,
    );
    // A longer allowed lead time tilts further toward the target's travel direction.
    expect(uncapped.y).toBeGreaterThan(capped.y);
  });

  it("a stationary target reduces pursue to seek / evade to flee", () => {
    const stationary: Kinematic = { position: new Vec2(0, 100), velocity: Vec2.ZERO };
    const pursued = pursue(stationary).evaluate(agent(Vec2.ZERO, Vec2.ZERO, 50), 1 / 60);
    const sought = seek(stationary.position).evaluate(agent(Vec2.ZERO, Vec2.ZERO, 50), 1 / 60);
    expect(pursued.x).toBeCloseTo(sought.x);
    expect(pursued.y).toBeCloseTo(sought.y);

    const evaded = evade(stationary).evaluate(agent(Vec2.ZERO, Vec2.ZERO, 50), 1 / 60);
    const fled = flee(stationary.position).evaluate(agent(Vec2.ZERO, Vec2.ZERO, 50), 1 / 60);
    expect(evaded.x).toBeCloseTo(fled.x);
    expect(evaded.y).toBeCloseTo(fled.y);
  });
});

describe("avoidObstacles", () => {
  it("steers laterally away from an obstacle straight ahead", () => {
    const obstacles: Obstacle[] = [{ position: new Vec2(50, 0), radius: 10 }];
    const behavior = avoidObstacles(obstacles, { lookAhead: 100 });
    const result = behavior.evaluate(agent(Vec2.ZERO, new Vec2(1, 0), 100), 1 / 60);
    expect(result).not.toEqual(Vec2.ZERO);
  });

  it("returns ZERO for an obstacle behind or off the ray", () => {
    const behind: Obstacle[] = [{ position: new Vec2(-50, 0), radius: 10 }];
    const offRay: Obstacle[] = [{ position: new Vec2(50, 500), radius: 10 }];
    const resultBehind = avoidObstacles(behind).evaluate(
      agent(Vec2.ZERO, new Vec2(1, 0), 100),
      1 / 60,
    );
    const resultOffRay = avoidObstacles(offRay).evaluate(
      agent(Vec2.ZERO, new Vec2(1, 0), 100),
      1 / 60,
    );
    expect(resultBehind).toEqual(Vec2.ZERO);
    expect(resultOffRay).toEqual(Vec2.ZERO);
  });

  it("returns ZERO for a stationary agent", () => {
    const obstacles: Obstacle[] = [{ position: new Vec2(50, 0), radius: 10 }];
    const result = avoidObstacles(obstacles).evaluate(agent(Vec2.ZERO), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });

  it("agentRadius widens the threat band", () => {
    // Obstacle offset far enough that a zero-radius agent clears it, but a
    // wide agentRadius turns it into a threat.
    const obstacles: Obstacle[] = [{ position: new Vec2(50, 30), radius: 5 }];
    const narrow = avoidObstacles(obstacles, { agentRadius: 0 }).evaluate(
      agent(Vec2.ZERO, new Vec2(1, 0), 100),
      1 / 60,
    );
    const wide = avoidObstacles(obstacles, { agentRadius: 40 }).evaluate(
      agent(Vec2.ZERO, new Vec2(1, 0), 100),
      1 / 60,
    );
    expect(narrow).toEqual(Vec2.ZERO);
    expect(wide).not.toEqual(Vec2.ZERO);
  });

  it("picks the closest of several obstacles", () => {
    const near: Obstacle = { position: new Vec2(20, 0), radius: 10 };
    const far: Obstacle = { position: new Vec2(80, 0), radius: 10 };
    const nearOnly = avoidObstacles([near]).evaluate(
      agent(Vec2.ZERO, new Vec2(1, 0), 100),
      1 / 60,
    );
    const both = avoidObstacles([far, near]).evaluate(
      agent(Vec2.ZERO, new Vec2(1, 0), 100),
      1 / 60,
    );
    expect(both.x).toBeCloseTo(nearOnly.x);
    expect(both.y).toBeCloseTo(nearOnly.y);
  });
});

describe("separation / alignment / cohesion", () => {
  it("separation pushes away from a close neighbor", () => {
    const neighbors: Kinematic[] = [{ position: new Vec2(10, 0), velocity: Vec2.ZERO }];
    const result = separation(neighbors, { radius: 40 }).evaluate(agent(Vec2.ZERO), 1 / 60);
    expect(result.x).toBeLessThan(0);
  });

  it("separation returns ZERO with no neighbor in radius", () => {
    const neighbors: Kinematic[] = [{ position: new Vec2(1000, 0), velocity: Vec2.ZERO }];
    const result = separation(neighbors, { radius: 40 }).evaluate(agent(Vec2.ZERO), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });

  it("symmetric separation cancels to ZERO", () => {
    const neighbors: Kinematic[] = [
      { position: new Vec2(10, 0), velocity: Vec2.ZERO },
      { position: new Vec2(-10, 0), velocity: Vec2.ZERO },
    ];
    const result = separation(neighbors, { radius: 40 }).evaluate(agent(Vec2.ZERO), 1 / 60);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it("alignment matches the mean heading of neighbors in radius", () => {
    const neighbors: Kinematic[] = [
      { position: new Vec2(10, 0), velocity: new Vec2(0, 100) },
      { position: new Vec2(-10, 0), velocity: new Vec2(0, 100) },
    ];
    const result = alignment(neighbors, { radius: 40 }).evaluate(
      agent(Vec2.ZERO, Vec2.ZERO, 100),
      1 / 60,
    );
    expect(result.y).toBeCloseTo(100);
    expect(result.x).toBeCloseTo(0);
  });

  it("alignment returns ZERO with no neighbor in radius", () => {
    const neighbors: Kinematic[] = [{ position: new Vec2(1000, 0), velocity: new Vec2(0, 100) }];
    const result = alignment(neighbors, { radius: 40 }).evaluate(agent(Vec2.ZERO), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });

  it("cohesion steers toward the centre of mass of neighbors in radius", () => {
    const neighbors: Kinematic[] = [
      { position: new Vec2(20, 0), velocity: Vec2.ZERO },
      { position: new Vec2(0, 20), velocity: Vec2.ZERO },
    ];
    const result = cohesion(neighbors, { radius: 40 }).evaluate(
      agent(Vec2.ZERO, Vec2.ZERO, 100),
      1 / 60,
    );
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
  });

  it("cohesion returns ZERO with no neighbor in radius", () => {
    const neighbors: Kinematic[] = [{ position: new Vec2(1000, 0), velocity: Vec2.ZERO }];
    const result = cohesion(neighbors, { radius: 40 }).evaluate(agent(Vec2.ZERO), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });
});

describe("followPath", () => {
  const path = [new Vec2(100, 0), new Vec2(100, 100), new Vec2(0, 100)];

  it("seeks the first waypoint at full speed", () => {
    const result = followPath(path).evaluate(agent(Vec2.ZERO, Vec2.ZERO, 50), 1 / 60);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(0);
  });

  it("advances to the next waypoint inside waypointRadius", () => {
    const behavior = followPath(path, { waypointRadius: 16 });
    const result = behavior.evaluate(agent(new Vec2(95, 0), Vec2.ZERO, 50), 1 / 60);
    expect(result.y).toBeCloseTo(50, 0); // now heading to (100, 100)
  });

  it("gives the final waypoint arrive semantics and fires onArrive once", () => {
    const onArrive = vi.fn();
    const behavior = followPath(path, { slowRadius: 100, arriveRadius: 4, onArrive });
    // Walk the index to the last waypoint.
    behavior.evaluate(agent(new Vec2(100, 0)), 1 / 60);
    behavior.evaluate(agent(new Vec2(100, 100)), 1 / 60);

    const ramped = behavior.evaluate(agent(new Vec2(50, 100), Vec2.ZERO, 100), 1 / 60);
    expect(ramped.length()).toBeCloseTo(50); // d=50 inside slowRadius 100 at maxSpeed 100

    const settled = behavior.evaluate(agent(new Vec2(1, 100)), 1 / 60);
    expect(settled).toEqual(Vec2.ZERO);
    behavior.evaluate(agent(new Vec2(1, 100)), 1 / 60);
    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it("loop wraps back to the first waypoint instead of settling", () => {
    const behavior = followPath(path, { loop: true, waypointRadius: 16 });
    behavior.evaluate(agent(new Vec2(100, 0)), 1 / 60);
    behavior.evaluate(agent(new Vec2(100, 100)), 1 / 60);
    // At the last waypoint: advances back to (100, 0), never ZERO.
    const result = behavior.evaluate(agent(new Vec2(0, 100), Vec2.ZERO, 50), 1 / 60);
    expect(result.length()).toBeCloseTo(50);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeLessThan(0);
  });

  it("returns ZERO for an empty waypoint list", () => {
    const result = followPath([]).evaluate(agent(Vec2.ZERO), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });

  it("startAt resumes from a saved waypoint index", () => {
    const behavior = followPath(path, { startAt: 2 });
    const result = behavior.evaluate(agent(new Vec2(50, 100), Vec2.ZERO, 50), 1 / 60);
    expect(result.x).toBeLessThan(0); // heading to (0, 100), not back to (100, 0)
    expect(behavior.waypointIndex).toBe(2);
  });

  it("startAt 'nearest' enters the path at the closest waypoint", () => {
    const behavior = followPath(path, { startAt: "nearest" });
    behavior.evaluate(agent(new Vec2(120, 60), Vec2.ZERO, 50), 1 / 60);
    expect(behavior.waypointIndex).toBe(1); // (100, 100) is closest, outside waypointRadius
  });

  it("waypointIndex tracks advancement for saving", () => {
    const behavior = followPath(path, { waypointRadius: 16 });
    expect(behavior.waypointIndex).toBe(0);
    behavior.evaluate(agent(new Vec2(95, 0)), 1 / 60);
    expect(behavior.waypointIndex).toBe(1);
  });
});

describe("contain", () => {
  const bounds = { x: 0, y: 0, width: 200, height: 200 };

  it("returns ZERO while the look-ahead point stays inside", () => {
    const result = contain(bounds, { lookAhead: 50 }).evaluate(
      agent(new Vec2(100, 100), new Vec2(100, 0)),
      1 / 60,
    );
    expect(result).toEqual(Vec2.ZERO);
  });

  it("steers inward when heading across an edge, keeping the along-edge component", () => {
    // Moving right-and-slightly-down near the right edge: x flips inward, y keeps sign.
    const result = contain(bounds, { lookAhead: 60 }).evaluate(
      agent(new Vec2(180, 100), new Vec2(100, 20).normalize().scale(100), 100),
      1 / 60,
    );
    expect(result.x).toBeLessThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(result.length()).toBeCloseTo(100);
  });

  it("steers a stationary agent outside the bounds straight back in", () => {
    const result = contain(bounds).evaluate(agent(new Vec2(-40, 100), Vec2.ZERO, 80), 1 / 60);
    expect(result.x).toBeCloseTo(80);
    expect(result.y).toBeCloseTo(0);
  });

  it("steers diagonally inward from a corner violation", () => {
    const result = contain(bounds, { lookAhead: 10 }).evaluate(
      agent(new Vec2(210, 210), Vec2.ZERO, 100),
      1 / 60,
    );
    expect(result.x).toBeLessThan(0);
    expect(result.y).toBeLessThan(0);
  });
});

/** A deterministic `random()` replaying a fixed sequence, cycling once exhausted. */
function deterministicRandom(sequence: number[]): () => number {
  let i = 0;
  return () => sequence[i++ % sequence.length]!;
}
