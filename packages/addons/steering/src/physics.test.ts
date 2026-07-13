import { describe, expect, it, vi } from "vitest";
import { createMockEntity, Transform, Vec2 } from "@yagejs/core";
import type { PhysicsWorld, RaycastHit, RigidBodyComponent } from "@yagejs/physics";

// The value import of RigidBodyComponent drags in Rapier's WASM package,
// which node/vitest can't resolve. Nothing here constructs a PhysicsWorld,
// so an empty module suffices.
vi.mock("@dimforge/rapier2d", () => ({ default: {} }));
import type { ImpulseBody, VelocityBody } from "./SteeringAgent.js";
import { avoidColliders, physicsNeighbors } from "./physics.js";
import type { AgentState } from "./core/types.js";

// Pins the structural contract: `body` accepts a RigidBodyComponent as-is.
// If the physics API drifts, these conditional types become `never` and the
// assignments below stop typechecking.
type VelocityConformance = RigidBodyComponent extends VelocityBody ? true : never;
type ImpulseConformance = RigidBodyComponent extends ImpulseBody ? true : never;

describe("RigidBodyComponent body conformance", () => {
  it("satisfies VelocityBody and ImpulseBody structurally", () => {
    const velocityConforms: VelocityConformance = true;
    const impulseConforms: ImpulseConformance = true;
    expect(velocityConforms).toBe(true);
    expect(impulseConforms).toBe(true);
  });
});

function agentState(
  position: Vec2,
  velocity: Vec2,
  maxSpeed = 100,
  entity?: AgentState["entity"],
): AgentState {
  return entity
    ? { position, velocity, maxSpeed, entity }
    : { position, velocity, maxSpeed };
}

describe("avoidColliders", () => {
  function fakeWorld(hits: (RaycastHit | null)[] = []) {
    let call = 0;
    const raycast = vi.fn(() => hits[call++] ?? null);
    return { raycast, world: { raycast } as unknown as PhysicsWorld };
  }

  it("returns ZERO when stationary without querying", () => {
    const { raycast, world } = fakeWorld();
    const result = avoidColliders(world).evaluate(
      agentState(Vec2.ZERO, Vec2.ZERO),
      1 / 60,
    );
    expect(result).toEqual(Vec2.ZERO);
    expect(raycast).not.toHaveBeenCalled();
  });

  it("casts a center ray plus two whiskers and returns ZERO with no hit", () => {
    const { raycast, world } = fakeWorld();
    const result = avoidColliders(world, { lookAhead: 100 }).evaluate(
      agentState(Vec2.ZERO, new Vec2(100, 0)),
      1 / 60,
    );
    expect(result).toEqual(Vec2.ZERO);
    expect(raycast).toHaveBeenCalledTimes(3);
    const lengths = raycast.mock.calls.map((c) => (c as unknown[])[2]);
    expect(lengths).toEqual([100, 70, 70]);
  });

  it("whiskerLength 0 casts only the center ray", () => {
    const { raycast, world } = fakeWorld();
    avoidColliders(world, { whiskerLength: 0 }).evaluate(
      agentState(Vec2.ZERO, new Vec2(100, 0)),
      1 / 60,
    );
    expect(raycast).toHaveBeenCalledTimes(1);
  });

  it("steers along the hit normal's lateral component", () => {
    const hit = {
      entity: undefined as never,
      point: new Vec2(50, 0),
      normal: new Vec2(-0.7071, -0.7071), // 45° surface
      distance: 50,
    } as RaycastHit;
    const { world } = fakeWorld([hit]);
    const result = avoidColliders(world).evaluate(
      agentState(Vec2.ZERO, new Vec2(100, 0), 80),
      1 / 60,
    );
    // Heading +x: the normal's x part is discarded, its -y part steers up.
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(-80);
  });

  it("a dead-center head-on hit commits to a perpendicular side", () => {
    const hit = {
      entity: undefined as never,
      point: new Vec2(50, 0),
      normal: new Vec2(-1, 0), // flat wall, exactly opposing the heading
      distance: 50,
    } as RaycastHit;
    const { world } = fakeWorld([hit]);
    const result = avoidColliders(world).evaluate(
      agentState(Vec2.ZERO, new Vec2(100, 0), 80),
      1 / 60,
    );
    expect(result.length()).toBeCloseTo(80);
    expect(Math.abs(result.y)).toBeCloseTo(80); // perpendicular to +x heading
  });

  it("picks the closest hit across rays and excludes the agent's entity", () => {
    const far = { point: new Vec2(90, 0), normal: new Vec2(0, -1), distance: 90 } as RaycastHit;
    const near = { point: new Vec2(30, 20), normal: new Vec2(0, 1), distance: 30 } as RaycastHit;
    const { raycast, world } = fakeWorld([far, near, null]);
    const { entity } = createMockEntity("self");

    const result = avoidColliders(world).evaluate(
      agentState(Vec2.ZERO, new Vec2(100, 0), 60, entity),
      1 / 60,
    );

    expect(result.y).toBeCloseTo(60); // near hit's normal (0, 1) wins
    for (const call of raycast.mock.calls) {
      expect((call as unknown[])[3]).toEqual({ excludeEntity: entity });
    }
  });
});

describe("physicsNeighbors", () => {
  it("maps queried entities to Kinematics, stationary without a body", () => {
    const { entity: neighbor } = createMockEntity("neighbor");
    neighbor.add(new Transform({ position: new Vec2(30, 40) }));
    const queryRadius = vi.fn(() => [neighbor]);
    const world = { queryRadius } as unknown as PhysicsWorld;

    const source = physicsNeighbors(world, { radius: 50 });
    const { entity: self } = createMockEntity("self");
    const result = (source as (agent: AgentState) => readonly unknown[])(
      agentState(new Vec2(10, 10), Vec2.ZERO, 100, self),
    );

    expect(result).toEqual([{ position: new Vec2(30, 40), velocity: Vec2.ZERO }]);
    expect(queryRadius).toHaveBeenCalledWith(new Vec2(10, 10), 50, {
      excludeEntity: self,
    });
  });

  it("defaults the radius to 80", () => {
    const queryRadius = vi.fn(() => []);
    const world = { queryRadius } as unknown as PhysicsWorld;
    (physicsNeighbors(world) as (agent: AgentState) => unknown)(
      agentState(Vec2.ZERO, Vec2.ZERO),
    );
    expect(queryRadius).toHaveBeenCalledWith(Vec2.ZERO, 80, {});
  });
});
