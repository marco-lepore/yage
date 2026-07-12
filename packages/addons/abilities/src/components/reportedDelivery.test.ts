import { describe, expect, it } from "vitest";
import { Entity, Transform, Vec2, createMockScene, trait } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { Hittable } from "../core/hit/types.js";
import type { HitResult } from "../core/hit/types.js";
import { createHitDelivery } from "../core/hit/delivery.js";
import { HitDealt, createReportingDelivery } from "./reportedDelivery.js";

@trait(Hittable)
class Target extends Entity {
  result: HitResult = "hit";
  receiveHit(): HitResult {
    return this.result;
  }
}

class Plain extends Entity {}

function spawnTarget(scene: Scene, x: number, y: number): Target {
  const target = scene.spawn(Target);
  target.add(new Transform({ position: new Vec2(x, y) }));
  return target;
}

describe("createReportingDelivery", () => {
  it("emits HitDealt on the source with the target and result when a hit lands", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const target = spawnTarget(scene, 10, 0);
    const events: { target: Entity; result: HitResult }[] = [];
    source.on(HitDealt, (payload) => events.push(payload));
    const delivery = createReportingDelivery({ source });

    const result = delivery.deliver(target, new Vec2(0, 0));

    expect(result).toBe("hit");
    expect(events).toEqual([{ target, result: "hit" }]);
  });

  it("emits with result 'blocked'/'parried' when the receiver reports a guard outcome", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const events: HitResult[] = [];
    source.on(HitDealt, (payload) => events.push(payload.result));
    const delivery = createReportingDelivery({ source });

    const blocker = spawnTarget(scene, 10, 0);
    blocker.result = "blocked";
    delivery.deliver(blocker, new Vec2(0, 0));

    const parrier = spawnTarget(scene, 10, 0);
    parrier.result = "parried";
    delivery.deliver(parrier, new Vec2(0, 0));

    expect(events).toEqual(["blocked", "parried"]);
  });

  it("does not emit when the result is 'ignored': own source, non-Hittable, and receiver-rejected", () => {
    const { scene } = createMockScene();
    const source = spawnTarget(scene, 0, 0); // Hittable, so it's the own-source case that matters
    const events: HitResult[] = [];
    source.on(HitDealt, (payload) => events.push(payload.result));
    const delivery = createReportingDelivery({ source });

    delivery.deliver(source, new Vec2(0, 0)); // own source
    delivery.deliver(scene.spawn(Plain), new Vec2(0, 0)); // non-Hittable

    const rejecter = spawnTarget(scene, 10, 0);
    rejecter.result = "ignored"; // e.g. team filter or i-frames
    delivery.deliver(rejecter, new Vec2(0, 0));

    expect(events).toEqual([]);
  });

  it("emits once per contact — a delivery reaching two targets emits twice", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const events: Entity[] = [];
    source.on(HitDealt, (payload) => events.push(payload.target));
    const delivery = createReportingDelivery({ source });

    const a = spawnTarget(scene, 10, 0);
    const b = spawnTarget(scene, 20, 0);
    delivery.deliver(a, new Vec2(0, 0));
    delivery.deliver(b, new Vec2(0, 0));

    expect(events).toEqual([a, b]);
  });

  it("returns the same HitResult as bare createHitDelivery for the same inputs", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const target = spawnTarget(scene, 10, 0);
    target.result = "parried";

    const bare = createHitDelivery({ source, data: { damage: 3 } });
    const reporting = createReportingDelivery({ source, data: { damage: 3 } });

    expect(reporting.deliver(target, new Vec2(0, 0))).toBe(
      bare.deliver(target, new Vec2(0, 0)),
    );
  });
});
