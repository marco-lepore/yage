import { describe, expect, it } from "vitest";
import { createMockEntity, Transform, Vec2 } from "@yagejs/core";
import { SteeringAgent } from "./SteeringAgent.js";
import { seek } from "./core/behaviors.js";

function setup(options: ConstructorParameters<typeof SteeringAgent>[0]) {
  const { entity, scene, context } = createMockEntity("agent-host");
  entity.add(new Transform({ position: Vec2.ZERO }));
  const agentComponent = new SteeringAgent(options);
  entity.add(agentComponent);
  return { entity, scene, context, agent: agentComponent };
}

describe("SteeringAgent", () => {
  it("default kinematic apply walks the Transform toward a seek target over frames", () => {
    const { entity, agent } = setup({
      maxSpeed: 60,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    const transform = entity.get(Transform);

    const positions: number[] = [transform.position.x];
    for (let i = 0; i < 5; i++) {
      agent.update(1 / 60);
      positions.push(transform.position.x);
    }

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it("maxAcceleration caps the per-frame velocity delta", () => {
    const { agent } = setup({
      maxSpeed: 100,
      maxAcceleration: 60, // px/s^2, dt = 1/60s -> max delta 1 px/s per frame
      behaviors: [seek(new Vec2(1000, 0))],
    });

    agent.update(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(1, 5);
    agent.update(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(2, 5);
  });

  it("without maxAcceleration the velocity snaps directly to the desired value", () => {
    const { agent } = setup({
      maxSpeed: 100,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    agent.update(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(100, 5);
  });

  it("faceHeading sets rotation to the commanded heading", () => {
    const { entity, agent } = setup({
      maxSpeed: 100,
      faceHeading: true,
      behaviors: [seek(new Vec2(0, 1000))],
    });
    agent.update(1 / 60);
    const transform = entity.get(Transform);
    expect(transform.rotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it("a custom apply receives the commanded velocity and skips the default integration", () => {
    const received: Vec2[] = [];
    const { entity } = setup({
      maxSpeed: 50,
      behaviors: [seek(new Vec2(1000, 0))],
      apply: (v) => received.push(v),
    });
    const transform = entity.get(Transform);
    const before = transform.position.x;

    const agentComponent = entity.get(SteeringAgent);
    agentComponent.update(1 / 60);

    expect(received).toHaveLength(1);
    expect(received[0]!.x).toBeCloseTo(50);
    expect(transform.position.x).toBe(before); // no default integration ran
  });

  it("enabled = false halts ticking", () => {
    const { entity, agent } = setup({
      maxSpeed: 50,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    agent.enabled = false;
    const transform = entity.get(Transform);
    const before = transform.position.x;

    agent.update(1 / 60);

    expect(transform.position.x).toBe(before);
    expect(agent.velocity).toEqual(Vec2.ZERO);
  });

  it("velocity reflects the last commanded value", () => {
    const { agent } = setup({
      maxSpeed: 40,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    expect(agent.velocity).toEqual(Vec2.ZERO);
    agent.update(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(40);
  });

  it("agent.steering.add(...) changes behavior live", () => {
    const { agent } = setup({ maxSpeed: 40, behaviors: [] });
    agent.update(1 / 60);
    expect(agent.velocity).toEqual(Vec2.ZERO);

    agent.steering.add(seek(new Vec2(1000, 0)));
    agent.update(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(40);
  });

  it("stop() zeroes velocity", () => {
    const { agent } = setup({
      maxSpeed: 40,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    agent.update(1 / 60);
    expect(agent.velocity.x).toBeGreaterThan(0);

    agent.stop();
    expect(agent.velocity).toEqual(Vec2.ZERO);
  });
});
