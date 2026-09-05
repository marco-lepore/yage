import { describe, expect, it } from "vitest";
import { Transform, Vec2, createMockEntity } from "@yagejs/core";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { TopDownPlayerMover } from "./TopDownPlayerMover.js";

function setup(isBlocked?: () => boolean) {
  const { entity, context } = createMockEntity();
  const input = new InputManager();
  input.setActionMap({
    "move-left": ["KeyA"],
    "move-right": ["KeyD"],
    "move-up": ["KeyW"],
    "move-down": ["KeyS"],
  });
  context.register(InputManagerKey, input);
  const transform = entity.add(new Transform());
  const bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
  const mover = entity.add(
    new TopDownPlayerMover({
      speed: 100,
      bounds,
      ...(isBlocked ? { isBlocked } : {}),
    }),
  );
  return { input, transform, bounds, mover };
}

describe("TopDownPlayerMover", () => {
  it("keeps diagonal and cardinal movement at the configured speed", () => {
    const { input, transform, mover } = setup();
    input._onKeyDown("KeyD");
    mover.update(0.5);
    expect(transform.position).toEqual(new Vec2(50, 0));
    transform.setPosition(0, 0);
    input._onKeyDown("KeyS");
    mover.update(0.5);
    expect(transform.position.length()).toBeCloseTo(50);
    expect(transform.position.x).toBeCloseTo(transform.position.y);
  });

  it("reads the live busy predicate and resumes held movement", () => {
    let blocked = true;
    const { input, transform, mover } = setup(() => blocked);
    input._onKeyDown("KeyD");
    mover.update(0.5);
    expect(transform.position).toEqual(Vec2.ZERO);
    blocked = false;
    mover.update(0.5);
    expect(transform.position.x).toBe(50);
  });

  it("clamps to current bounds and observes a gate extending the same object", () => {
    const { input, transform, bounds, mover } = setup();
    input._onKeyDown("KeyD");
    mover.update(2);
    expect(transform.position.x).toBe(100);
    bounds.maxX = 250;
    mover.update(2);
    expect(transform.position.x).toBe(250);
    input._onKeyUp("KeyD");
    mover.update(1);
    expect(transform.position.x).toBe(250);
  });
});
