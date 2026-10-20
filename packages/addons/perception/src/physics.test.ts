import { describe, expect, it, vi } from "vitest";
import { createMockScene, Vec2 } from "@yagejs/core";
import type { PhysicsWorld } from "@yagejs/physics";
import { perceptionRaycast } from "./physics.js";

describe("perceptionRaycast", () => {
  it("excludes the observer, accepts a first hit on target, and blocks another collider", () => {
    const { scene } = createMockScene();
    const observer = scene.spawn("observer");
    const target = scene.spawn("target");
    const wall = scene.spawn("wall");
    const raycast = vi.fn<PhysicsWorld["raycast"]>().mockReturnValue(null);
    const world = { raycast } as unknown as PhysicsWorld;
    const policy = perceptionRaycast(world, {
      filterGroups: 123,
      sensors: "exclude",
    });
    const context = {
      observer,
      target,
      origin: Vec2.ZERO,
      position: new Vec2(100, 0),
      distance: 100,
      angle: 0,
    };
    expect(policy(context)).toBe(true);
    expect(raycast).toHaveBeenCalledWith(Vec2.ZERO, { x: 100, y: 0 }, 100, {
      excludeEntity: observer,
      filterGroups: 123,
      sensors: "exclude",
    });
    raycast.mockReturnValue({
      entity: target,
      point: Vec2.ZERO,
      normal: Vec2.ZERO,
      distance: 90,
    });
    expect(policy(context)).toBe(true);
    raycast.mockReturnValue({
      entity: wall,
      point: Vec2.ZERO,
      normal: Vec2.ZERO,
      distance: 50,
    });
    expect(policy(context)).toBe(false);
    raycast.mockClear();
    expect(policy({ ...context, distance: 0, position: Vec2.ZERO })).toBe(true);
    expect(raycast).not.toHaveBeenCalled();
  });
});
