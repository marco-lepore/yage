import { describe, expect, it, vi } from "vitest";
import { createMockScene, Vec2 } from "@yagejs/core";
import type { PhysicsWorld } from "@yagejs/physics";

// The value import of PhysicsWorldKey drags in Rapier's WASM package, which
// node/vitest can't resolve. Nothing here constructs a PhysicsWorld, so an
// empty module suffices.
vi.mock("@dimforge/rapier2d", () => ({ default: {} }));
import { PhysicsWorldKey } from "@yagejs/physics";
import { perceptionRaycast } from "./physics.js";

describe("perceptionRaycast", () => {
  it("queries the observer scene's world, skips the observer, and accepts a first hit on the target", () => {
    const { scene } = createMockScene();
    const observer = scene.spawn("observer");
    const target = scene.spawn("target");
    const wall = scene.spawn("wall");
    const raycast = vi.fn<PhysicsWorld["raycast"]>().mockReturnValue(null);
    scene.registerScoped(PhysicsWorldKey, {
      raycast,
    } as unknown as PhysicsWorld);
    const lineOfSight = perceptionRaycast({
      filterGroups: 123,
      sensors: "include",
    });
    const context = {
      observer,
      target,
      origin: Vec2.ZERO,
      position: new Vec2(100, 0),
      distance: 100,
      angle: 0,
    };
    expect(lineOfSight(context)).toBe(true);
    expect(raycast).toHaveBeenCalledWith(Vec2.ZERO, { x: 100, y: 0 }, 100, {
      excludeEntity: observer,
      filterGroups: 123,
      sensors: "include",
    });
    raycast.mockReturnValue({
      entity: target,
      point: Vec2.ZERO,
      normal: Vec2.ZERO,
      distance: 90,
    });
    expect(lineOfSight(context)).toBe(true);
    raycast.mockReturnValue({
      entity: wall,
      point: Vec2.ZERO,
      normal: Vec2.ZERO,
      distance: 50,
    });
    expect(lineOfSight(context)).toBe(false);
    raycast.mockClear();
    expect(lineOfSight({ ...context, distance: 0, position: Vec2.ZERO })).toBe(
      true,
    );
    expect(raycast).not.toHaveBeenCalled();
  });
  it("leaves trigger colliders to the physics default when no options are passed", () => {
    const { scene } = createMockScene();
    const observer = scene.spawn("observer");
    const target = scene.spawn("target");
    const raycast = vi.fn<PhysicsWorld["raycast"]>().mockReturnValue(null);
    scene.registerScoped(PhysicsWorldKey, {
      raycast,
    } as unknown as PhysicsWorld);
    perceptionRaycast()({
      observer,
      target,
      origin: Vec2.ZERO,
      position: new Vec2(100, 0),
      distance: 100,
      angle: 0,
    });
    expect(raycast).toHaveBeenCalledWith(Vec2.ZERO, { x: 100, y: 0 }, 100, {
      excludeEntity: observer,
    });
  });
});
