import { describe, expect, it, vi } from "vitest";
import { Vec2 } from "@yagejs/core";
import {
  alignment,
  arrive,
  avoidObstacles,
  cohesion,
  evade,
  flee,
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
    // Moving right: wander circle sits ahead along +x.
    const moving = behavior.evaluate(agent(Vec2.ZERO, new Vec2(1, 0), 100), 1 / 60);
    // Now stationary: heading should fall back to the last (rightward) heading,
    // not snap to Vec2.RIGHT-from-scratch or collapse to ZERO.
    const stationary = behavior.evaluate(agent(Vec2.ZERO, Vec2.ZERO, 100), 1 / 60);
    expect(moving.length()).toBeCloseTo(100);
    expect(stationary.length()).toBeCloseTo(100);
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

/** A deterministic `random()` replaying a fixed sequence, cycling once exhausted. */
function deterministicRandom(sequence: number[]): () => number {
  let i = 0;
  return () => sequence[i++ % sequence.length]!;
}
