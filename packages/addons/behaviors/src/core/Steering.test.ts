import { describe, expect, it } from "vitest";
import { Vec2 } from "@yagejs/core";
import { Steering } from "./Steering.js";
import type { AgentState, SteeringBehavior } from "./types.js";
import { seek } from "./behaviors.js";

function agentAt(position: Vec2, maxSpeed = 100): AgentState {
  return { position, velocity: Vec2.ZERO, maxSpeed };
}

/** A constant-output behavior, for isolating blend math from a real behavior's own logic. */
function constant(vector: Vec2, weight = 1): SteeringBehavior {
  return { weight, evaluate: () => vector };
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
});
