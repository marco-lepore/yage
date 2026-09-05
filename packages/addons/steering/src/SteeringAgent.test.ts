import { describe, expect, it, vi } from "vitest";
import { createMockEntity, Transform, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
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
  it.each([60, Infinity])(
    "preserves state and skips behaviors and custom apply at dt=0 with acceleration %s",
    (maxAcceleration) => {
      const apply = vi.fn();
      const { entity, agent } = setup({
        maxSpeed: 100,
        maxAcceleration,
        behaviors: [seek(new Vec2(20, 40))],
        apply,
        faceHeading: true,
      });
      agent.fixedUpdate(0.1);
      const compute = vi.spyOn(agent.steering, "compute");
      const velocity = agent.velocity;
      const transform = entity.get(Transform);
      const position = transform.position;
      const rotation = transform.rotation;
      apply.mockClear();
      agent.fixedUpdate(0);
      expect(agent.velocity).toBe(velocity);
      expect(transform.position).toEqual(position);
      expect(transform.rotation).toBe(rotation);
      expect(compute).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it.each(["velocity", "impulse"] as const)(
    "does not read or drive a %s body at dt=0",
    (drive) => {
      const body = {
        getVelocity: vi.fn(() => Vec2.ZERO),
        setVelocity: vi.fn(),
        applyImpulse: vi.fn(),
        getMass: vi.fn(() => 1),
      };
      const { agent } = setup({
        maxSpeed: 100,
        maxAcceleration: Infinity,
        body,
        drive,
      });
      agent.fixedUpdate(0);
      for (const callback of Object.values(body))
        expect(callback).not.toHaveBeenCalled();
      expect(agent.velocity).toEqual(Vec2.ZERO);
    },
  );
  it("default kinematic apply walks the Transform toward a seek target over steps", () => {
    const { entity, agent } = setup({
      maxSpeed: 60,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    const transform = entity.get(Transform);

    const positions: number[] = [transform.position.x];
    for (let i = 0; i < 5; i++) {
      agent.fixedUpdate(1 / 60);
      positions.push(transform.position.x);
    }

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it("maxAcceleration caps the per-step velocity delta", () => {
    const { agent } = setup({
      maxSpeed: 100,
      maxAcceleration: 60, // px/s^2, dt = 1/60s -> max delta 1 px/s per step
      behaviors: [seek(new Vec2(1000, 0))],
    });

    agent.fixedUpdate(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(1, 5);
    agent.fixedUpdate(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(2, 5);
  });

  it("maxAcceleration defaults to 4x maxSpeed", () => {
    const { agent } = setup({
      maxSpeed: 100,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    expect(agent.maxAcceleration).toBe(400);
    agent.fixedUpdate(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(400 / 60, 5); // ramping, not snapped
  });

  it("maxAcceleration: Infinity snaps the velocity to the desired value", () => {
    const { agent } = setup({
      maxSpeed: 100,
      maxAcceleration: Infinity,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    agent.fixedUpdate(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(100, 5);
  });

  it("faceHeading sets rotation to the commanded heading", () => {
    const { entity, agent } = setup({
      maxSpeed: 100,
      maxAcceleration: Infinity,
      faceHeading: true,
      behaviors: [seek(new Vec2(0, 1000))],
    });
    agent.fixedUpdate(1 / 60);
    const transform = entity.get(Transform);
    expect(transform.rotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it("a custom apply receives the commanded velocity and skips the default integration", () => {
    const received: Vec2[] = [];
    const { entity } = setup({
      maxSpeed: 50,
      maxAcceleration: Infinity,
      behaviors: [seek(new Vec2(1000, 0))],
      apply: (v) => received.push(v),
    });
    const transform = entity.get(Transform);
    const before = transform.position.x;

    const agentComponent = entity.get(SteeringAgent);
    agentComponent.fixedUpdate(1 / 60);

    expect(received).toHaveLength(1);
    expect(received[0]!.x).toBeCloseTo(50);
    expect(transform.position.x).toBe(before); // no default integration ran
  });

  it("enabled = false halts steering", () => {
    const { entity, agent } = setup({
      maxSpeed: 50,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    agent.enabled = false;
    const transform = entity.get(Transform);
    const before = transform.position.x;

    agent.fixedUpdate(1 / 60);

    expect(transform.position.x).toBe(before);
    expect(agent.velocity).toEqual(Vec2.ZERO);
  });

  it("velocity reflects the last commanded value", () => {
    const { agent } = setup({
      maxSpeed: 40,
      maxAcceleration: Infinity,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    expect(agent.velocity).toEqual(Vec2.ZERO);
    agent.fixedUpdate(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(40);
  });

  it("agent.steering.add(...) changes behavior live", () => {
    const { agent } = setup({
      maxSpeed: 40,
      maxAcceleration: Infinity,
      behaviors: [],
    });
    agent.fixedUpdate(1 / 60);
    expect(agent.velocity).toEqual(Vec2.ZERO);

    agent.steering.add(seek(new Vec2(1000, 0)));
    agent.fixedUpdate(1 / 60);
    expect(agent.velocity.x).toBeCloseTo(40);
  });

  it("stop() zeroes velocity", () => {
    const { agent } = setup({
      maxSpeed: 40,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    agent.fixedUpdate(1 / 60);
    expect(agent.velocity.x).toBeGreaterThan(0);

    agent.stop();
    expect(agent.velocity).toEqual(Vec2.ZERO);
  });

  it("steers in fixedUpdate", () => {
    const { entity, agent } = setup({
      maxSpeed: 60,
      maxAcceleration: Infinity,
      behaviors: [seek(new Vec2(1000, 0))],
    });
    const transform = entity.get(Transform);

    // No update hook, so the Update pass skips the component entirely.
    expect((agent as { update?: unknown }).update).toBeUndefined();

    agent.fixedUpdate(1 / 60);
    expect(transform.position.x).toBeCloseTo(1, 5); // 60 px/s * 1/60 s
  });

  it("stop() pushes a zero through a custom apply", () => {
    const received: Vec2[] = [];
    const { agent } = setup({
      maxSpeed: 40,
      behaviors: [seek(new Vec2(1000, 0))],
      apply: (v) => received.push(v),
    });
    agent.fixedUpdate(1 / 60);
    agent.stop();
    expect(received.at(-1)).toEqual(Vec2.ZERO);
  });
});

function fakeVelocityBody(initial: Vec2Like = Vec2.ZERO) {
  let velocity = initial;
  const setCalls: Vec2Like[] = [];
  return {
    setCalls,
    setVelocity(v: Vec2Like) {
      setCalls.push(v);
      velocity = v;
    },
    getVelocity() {
      return velocity;
    },
    /** Test hook: the world changes the velocity (knockback, wall pin). */
    interfere(v: Vec2Like) {
      velocity = v;
    },
  };
}

function fakeImpulseBody(mass: number) {
  let velocity = new Vec2(0, 0);
  const impulses: Vec2Like[] = [];
  return {
    impulses,
    applyImpulse(i: Vec2Like) {
      impulses.push(i);
      velocity = new Vec2(velocity.x + i.x / mass, velocity.y + i.y / mass);
    },
    getVelocity() {
      return velocity;
    },
    getMass() {
      return mass;
    },
    /** Test hook: the world changes the velocity (knockback, wall pin). */
    interfere(v: Vec2) {
      velocity = v;
    },
  };
}

describe("SteeringAgent with a body", () => {
  it("the acceleration ramp starts from the body's actual velocity", () => {
    const body = fakeVelocityBody();
    const { agent } = setup({
      maxSpeed: 100,
      maxAcceleration: 60, // dt 1/60 -> 1 px/s per step
      behaviors: [seek(new Vec2(1000, 0))],
      body,
    });

    agent.fixedUpdate(1 / 60);
    expect(body.setCalls.at(-1)!.x).toBeCloseTo(1, 5);

    body.interfere({ x: -50, y: 0 }); // wall pin / knockback
    agent.fixedUpdate(1 / 60);
    expect(body.setCalls.at(-1)!.x).toBeCloseTo(-49, 5); // ramps from -50, not from 1
  });

  it("behaviors read the body's actual velocity, not the commanded one", () => {
    const seen: Vec2[] = [];
    const body = fakeVelocityBody();
    const { agent } = setup({
      maxSpeed: 100,
      behaviors: [
        {
          weight: 1,
          priority: 0,
          evaluate: (state) => {
            seen.push(state.velocity);
            return Vec2.ZERO;
          },
        },
      ],
      body,
    });

    body.interfere({ x: 7, y: 0 });
    agent.fixedUpdate(1 / 60);
    expect(seen.at(-1)!.x).toBe(7);
  });

  it("velocity drive writes the commanded velocity to the body and skips Transform integration", () => {
    const body = fakeVelocityBody();
    const { entity, agent } = setup({
      maxSpeed: 50,
      maxAcceleration: Infinity,
      behaviors: [seek(new Vec2(1000, 0))],
      body,
    });
    const transform = entity.get(Transform);
    const before = transform.position.x;

    agent.fixedUpdate(1 / 60);

    expect(body.setCalls.at(-1)!.x).toBeCloseTo(50, 5);
    expect(transform.position.x).toBe(before);
  });

  it("impulse drive applies the capped velocity correction scaled by mass", () => {
    const body = fakeImpulseBody(2);
    const { agent } = setup({
      maxSpeed: 100,
      maxAcceleration: 60, // dv cap 1 px/s per step
      drive: "impulse",
      behaviors: [seek(new Vec2(1000, 0))],
      body,
    });

    agent.fixedUpdate(1 / 60);
    agent.fixedUpdate(1 / 60);

    expect(body.impulses).toHaveLength(2);
    expect(body.impulses[0]!.x).toBeCloseTo(2, 5); // dv 1 * mass 2
    expect(body.impulses[1]!.x).toBeCloseTo(2, 5);
    expect(body.getVelocity().x).toBeCloseTo(2, 5);
  });

  it("impulse drive lets a knockback persist and recover at the cap, not snap back", () => {
    const body = fakeImpulseBody(1);
    const { agent } = setup({
      maxSpeed: 100,
      maxAcceleration: 60,
      drive: "impulse",
      behaviors: [seek(new Vec2(1000, 0))],
      body,
    });

    body.interfere(new Vec2(0, -200)); // knockback upward
    agent.fixedUpdate(1 / 60);

    // One step corrects by at most 1 px/s toward the desired velocity.
    const v = body.getVelocity();
    expect(Math.hypot(v.x - 0, v.y - -200)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("body and apply together throw at construction", () => {
    const body = fakeVelocityBody();
    expect(
      () => new SteeringAgent({ maxSpeed: 100, body, apply: () => undefined }),
    ).toThrow(/not both/);
  });

  it("stop() writes zero through a velocity body", () => {
    const body = fakeVelocityBody();
    const { agent } = setup({
      maxSpeed: 40,
      behaviors: [seek(new Vec2(1000, 0))],
      body,
    });
    agent.fixedUpdate(1 / 60);
    agent.stop();
    expect(body.setCalls.at(-1)).toEqual(Vec2.ZERO);
  });

  it("stop() cancels an impulse body's velocity with a counter-impulse", () => {
    const body = fakeImpulseBody(2);
    const { agent } = setup({
      maxSpeed: 40,
      maxAcceleration: 600,
      drive: "impulse",
      behaviors: [],
      body,
    });
    body.interfere(new Vec2(10, -4));
    agent.stop();
    expect(body.impulses.at(-1)!.x).toBeCloseTo(-20, 5);
    expect(body.impulses.at(-1)!.y).toBeCloseTo(8, 5);
    expect(body.getVelocity().x).toBeCloseTo(0, 5);
  });

  it("faceHeading ignores sub-1px/s jitter velocities", () => {
    const { entity, agent } = setup({
      maxSpeed: 100,
      maxAcceleration: Infinity,
      faceHeading: true,
      behaviors: [
        { weight: 1, priority: 0, evaluate: () => new Vec2(0.5, 0.5) },
      ],
    });
    const transform = entity.get(Transform);
    transform.setRotation(0.7);

    agent.fixedUpdate(1 / 60);
    expect(transform.rotation).toBe(0.7); // |v| ~0.7 px/s -> below the threshold

    agent.setBehaviors([seek(new Vec2(0, 1000))]);
    agent.fixedUpdate(1 / 60);
    expect(transform.rotation).toBeCloseTo(Math.PI / 2, 3);
  });
});
