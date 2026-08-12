import { describe, expect, it } from "vitest";
import { Vec2 } from "@yagejs/core";
import { Steering } from "./Steering.js";
import type { AgentState, SteeringBehavior } from "./types.js";
import { seek } from "./behaviors.js";

function agentAt(position: Vec2, maxSpeed = 100): AgentState {
  return { position, velocity: Vec2.ZERO, maxSpeed };
}

/** A constant-output behavior, for isolating blend math from a real behavior's own logic. */
function constant(vector: Vec2, weight = 1, priority = 0): SteeringBehavior {
  return { weight, priority, evaluate: () => vector };
}

describe("Steering.compute", () => {
  it("returns ZERO with no behaviors", () => {
    const steering = new Steering();
    const result = steering.compute(agentAt(Vec2.ZERO), 1 / 60);
    expect(result).toEqual(Vec2.ZERO);
  });

  it("points a single seek at the target with magnitude maxSpeed", () => {
    const steering = new Steering([seek(new Vec2(100, 0))]);
    const result = steering.compute(agentAt(Vec2.ZERO, 50), 1 / 60);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(0);
    expect(result.length()).toBeCloseTo(50);
  });

  it("weighted-sums multiple contributions then clamps to maxSpeed", () => {
    const steering = new Steering([
      constant(new Vec2(100, 0), 1),
      constant(new Vec2(0, 100), 1),
    ]);
    const result = steering.compute(agentAt(Vec2.ZERO, 60), 1 / 60);
    // Unclamped sum is (100, 100), length ~141.4 > maxSpeed 60 — clamped to 60,
    // direction preserved (still 45°).
    expect(result.length()).toBeCloseTo(60);
    expect(result.x).toBeCloseTo(result.y);
  });

  it("never exceeds maxSpeed regardless of contribution magnitudes", () => {
    const steering = new Steering([
      constant(new Vec2(1000, 0)),
      constant(new Vec2(0, 1000)),
      constant(new Vec2(-500, 500)),
    ]);
    const result = steering.compute(agentAt(Vec2.ZERO, 30), 1 / 60);
    expect(result.length()).toBeLessThanOrEqual(30 + 1e-6);
  });

  it("scales a contribution by its weight", () => {
    const steering = new Steering([constant(new Vec2(10, 0), 3)]);
    const result = steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60);
    expect(result.x).toBeCloseTo(30);
  });

  it("add/remove/clear change the blend", () => {
    const behavior = constant(new Vec2(10, 0));
    const steering = new Steering();
    expect(steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60)).toEqual(Vec2.ZERO);

    steering.add(behavior);
    expect(steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60).x).toBeCloseTo(10);

    steering.remove(behavior);
    expect(steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60)).toEqual(Vec2.ZERO);

    steering.add(behavior).add(constant(new Vec2(0, 10)));
    steering.clear();
    expect(steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60)).toEqual(Vec2.ZERO);
  });

  it("a non-zero higher tier overrides the lower tier outright", () => {
    const steering = new Steering([
      constant(new Vec2(100, 0), 1, 0), // seek-like, tier 0
      constant(new Vec2(0, 100), 1, 1), // avoid-like, tier 1
    ]);
    const result = steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60);
    expect(result.x).toBeCloseTo(0); // tier 0 never enters the sum
    expect(result.y).toBeCloseTo(100);
  });

  it("a silent higher tier falls through to the weighted sum below", () => {
    const steering = new Steering([
      constant(new Vec2(100, 0), 1, 0),
      constant(Vec2.ZERO, 1, 1),
    ]);
    const result = steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60);
    expect(result.x).toBeCloseTo(100);
  });

  it("behaviors within one tier still weighted-sum", () => {
    const steering = new Steering([
      constant(new Vec2(100, 0), 1, 2),
      constant(new Vec2(0, 100), 3, 2),
      constant(new Vec2(-1000, -1000), 1, 0), // never consulted
    ]);
    const result = steering.compute(agentAt(Vec2.ZERO, 1000), 1 / 60);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(300);
  });

  it("lower tiers are not evaluated when a higher tier wins", () => {
    let lowerEvaluated = 0;
    const lower: SteeringBehavior = {
      weight: 1,
      priority: 0,
      evaluate: () => {
        lowerEvaluated++;
        return new Vec2(100, 0);
      },
    };
    const steering = new Steering([lower, constant(new Vec2(0, 100), 1, 1)]);

    steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60);
    expect(lowerEvaluated).toBe(0);

    steering.remove(steering.behaviors[1]!);
    steering.compute(agentAt(Vec2.ZERO, 100), 1 / 60);
    expect(lowerEvaluated).toBe(1);
  });
});
