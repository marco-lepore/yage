import { describe, it, expect } from "vitest";
import { Entity, Transform, Vec2 } from "@yagejs/core";
import { transformSequenceTarget, combineSequenceTargets } from "./bindings.js";
describe("entity sequence bindings", () => {
  it("uses world position with a placement offset and leaves scale untouched", () => {
    const parent = new Entity("parent");
    parent.add(
      new Transform({ position: new Vec2(100, 20), scale: new Vec2(2, 2) }),
    );
    const actor = new Entity("actor");
    actor.add(new Transform());
    parent.addChild("actor", actor);
    const binding = transformSequenceTarget(actor, { x: 0, y: 10 });
    binding.properties.position!.set({ x: 200, y: 80 });
    expect(actor.get(Transform).position).toEqual(new Vec2(50, 25));
    expect(actor.get(Transform).scale).toEqual(new Vec2(1, 1));
    expect(binding.properties.position!.get()).toEqual({ x: 200, y: 80 });
  });
  it("expires when the bound component is removed", () => {
    const actor = new Entity("actor");
    actor.add(new Transform());
    const binding = transformSequenceTarget(actor);
    expect(binding.isAlive?.()).toBe(true);
    actor.remove(Transform);
    expect(binding.isAlive?.()).toBe(false);
  });
  it("rejects accidental capability replacement", () => {
    const actor = new Entity("actor");
    actor.add(new Transform());
    const binding = transformSequenceTarget(actor);
    expect(() => combineSequenceTargets(binding, binding)).toThrow(
      "duplicate property",
    );
  });
});

describe("hierarchy-safe sequence writes", () => {
  it("applies and restores child world positions after all ancestor transforms regardless of track order", async () => {
    const { ErrorBoundary, Logger, LogLevel } = await import("@yagejs/core");
    const { SequencePlayer } = await import("./core/SequencePlayer.js");
    const { SequenceClip } = await import("./core/evaluate.js");
    const parent = new Entity("parent");
    parent.add(
      new Transform({
        position: new Vec2(20, 30),
        rotation: 0.2,
        scale: new Vec2(2, 3),
      }),
    );
    const child = new Entity("child");
    child.add(new Transform({ position: new Vec2(10, 15) }));
    parent.addChild("child", child);
    const start = {
      parent: parent.get(Transform).worldPosition,
      child: child.get(Transform).worldPosition,
    };
    const properties = {
      position: { kind: "position" },
      rotation: { kind: "number" },
      scale: { kind: "vector" },
    };
    const clip = new SequenceClip({
      format: "yage-sequence",
      version: 1,
      name: "hierarchy",
      fps: 30,
      duration: 60,
      frame: { width: 960, height: 540 },
      targets: {
        child: { properties, events: {} },
        parent: { properties, events: {} },
      },
      tracks: [
        {
          id: "child-x",
          target: "child",
          property: "position",
          position: { mode: "proportional" },
          keys: [
            { id: "cx0", frame: 0, value: { x: 150, y: 80 }, curve: "linear" },
          ],
        },
        {
          id: "parent-x",
          target: "parent",
          property: "position",
          position: { mode: "proportional" },
          keys: [
            { id: "px0", frame: 0, value: { x: 100, y: 20 }, curve: "linear" },
          ],
        },
        {
          id: "parent-r",
          target: "parent",
          property: "rotation",
          keys: [{ id: "pr0", frame: 0, value: 1, curve: "linear" }],
        },
        {
          id: "parent-s",
          target: "parent",
          property: "scale",
          keys: [
            { id: "ps0", frame: 0, value: { x: 3, y: 2 }, curve: "linear" },
          ],
        },
      ],
      events: [],
    });
    const player = new SequencePlayer(
      new ErrorBoundary(new Logger({ level: LogLevel.None })),
    );
    player.play(clip, {
      targets: {
        child: combineSequenceTargets(transformSequenceTarget(child)),
        parent: transformSequenceTarget(parent),
      },
    });
    expect(child.get(Transform).worldPosition.x).toBeCloseTo(150);
    expect(child.get(Transform).worldPosition.y).toBeCloseTo(80);
    player.seek(30);
    expect(child.get(Transform).worldPosition.x).toBeCloseTo(150);
    player.cancel("restore");
    expect(parent.get(Transform).worldPosition).toEqual(start.parent);
    expect(child.get(Transform).worldPosition.x).toBeCloseTo(start.child.x);
    expect(child.get(Transform).worldPosition.y).toBeCloseTo(start.child.y);
    expect(parent.get(Transform).rotation).toBe(0.2);
    expect(parent.get(Transform).scale).toEqual(new Vec2(2, 3));
  });
});
