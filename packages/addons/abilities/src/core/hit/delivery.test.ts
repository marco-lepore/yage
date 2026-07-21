import { describe, expect, it, vi } from "vitest";
import { Entity, Transform, Vec2, createMockScene, trait } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { Hittable } from "./types.js";
import type { Hit, HitResult } from "./types.js";
import {
  createHitDelivery,
  resolveHitSpec,
  shouldConsumeProjectile,
} from "./delivery.js";
import type { StepContext } from "../types.js";

@trait(Hittable)
class Target extends Entity {
  received: Hit[] = [];
  result: HitResult = "hit";
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return this.result;
  }
}

class Plain extends Entity {}

function spawnTarget(scene: Scene, x: number, y: number): Target {
  const target = scene.spawn(Target);
  target.add(new Transform({ position: new Vec2(x, y) }));
  return target;
}

describe("createHitDelivery", () => {
  it("delivers the payload to a Hittable entity and returns its result", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const target = spawnTarget(scene, 10, 0);
    const delivery = createHitDelivery({ source, data: { damage: 3 } });

    expect(delivery.deliver(target, new Vec2(0, 0))).toBe("hit");
    expect(target.received).toHaveLength(1);
    const hit = target.received[0]!;
    expect(hit.source).toBe(source);
    expect(hit.data).toEqual({ damage: 3 });
    expect(hit.tags).toEqual([]);
    expect("team" in hit).toBe(false);
  });

  it("passes the receiver's result through", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const target = spawnTarget(scene, 10, 0);
    target.result = "ignored";
    const delivery = createHitDelivery({ source });

    expect(delivery.deliver(target, new Vec2(0, 0))).toBe("ignored");
  });

  it("gives each victim its own copy of data — mutating one doesn't affect another's or the def's own object", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const data = { damage: 10 };
    const delivery = createHitDelivery({ source, data });

    const a = spawnTarget(scene, 10, 0);
    const b = spawnTarget(scene, 20, 0);
    delivery.deliver(a, new Vec2(0, 0));
    delivery.deliver(b, new Vec2(0, 0));
    a.received[0]!.data.damage = 1; // simulates a mutating resolution stage

    expect(a.received[0]!.data).not.toBe(b.received[0]!.data);
    expect(b.received[0]!.data.damage).toBe(10);
    expect(data.damage).toBe(10); // the def's own object is untouched
  });

  it("stamps team and tags into every payload", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const target = spawnTarget(scene, 10, 0);
    const delivery = createHitDelivery({
      source,
      team: "player",
      tags: ["fire"],
    });

    delivery.deliver(target, new Vec2(0, 0));
    expect(target.received[0]!.team).toBe("player");
    expect(target.received[0]!.tags).toEqual(["fire"]);
  });

  it("never delivers to its own source (owner exclusion)", () => {
    const { scene } = createMockScene();
    const source = spawnTarget(scene, 0, 0); // the source is itself Hittable
    const delivery = createHitDelivery({ source });

    expect(delivery.deliver(source, new Vec2(5, 5))).toBe("ignored");
    expect(source.received).toHaveLength(0);
  });

  it("ignores entities without the Hittable trait", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const plain = scene.spawn(Plain);
    const delivery = createHitDelivery({ source });

    expect(delivery.deliver(plain, new Vec2(0, 0))).toBe("ignored");
  });

  it("computes a unit direction from the impact position to the victim", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const delivery = createHitDelivery({ source });

    const east = spawnTarget(scene, 10, 0);
    delivery.deliver(east, new Vec2(0, 0));
    expect(east.received[0]!.direction.x).toBeCloseTo(1);
    expect(east.received[0]!.direction.y).toBeCloseTo(0);

    const south = spawnTarget(scene, 3, 9);
    delivery.deliver(south, new Vec2(3, 4));
    expect(south.received[0]!.direction.x).toBeCloseTo(0);
    expect(south.received[0]!.direction.y).toBeCloseTo(1);
  });

  it("falls back to +x when positions coincide or the victim has no Transform", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const delivery = createHitDelivery({ source });

    const coincident = spawnTarget(scene, 5, 5);
    delivery.deliver(coincident, new Vec2(5, 5));
    expect(coincident.received[0]!.direction).toEqual(new Vec2(1, 0));

    const noTransform = scene.spawn(Target);
    delivery.deliver(noTransform, new Vec2(0, 0));
    expect(noTransform.received[0]!.direction).toEqual(new Vec2(1, 0));
  });
});

describe("resolveHitSpec", () => {
  it("returns static data as-is", () => {
    const data = { damage: 5 };
    expect(resolveHitSpec(data, {} as StepContext)).toBe(data);
  });

  it("invokes a builder once with the step context", () => {
    const ctx = {} as StepContext;
    const builder = vi.fn(() => ({ damage: 7 }));
    expect(resolveHitSpec(builder, ctx)).toEqual({ damage: 7 });
    expect(builder).toHaveBeenCalledExactlyOnceWith(ctx);
  });
});

describe("shouldConsumeProjectile", () => {
  it("consumes on any non-ignored result (hit, blocked, parried)", () => {
    expect(shouldConsumeProjectile("hit", false)).toBe(true);
    expect(shouldConsumeProjectile("hit", true)).toBe(true);
    expect(shouldConsumeProjectile("blocked", true)).toBe(true);
    expect(shouldConsumeProjectile("parried", true)).toBe(true);
  });

  it("consumes on solid contacts that don't land (walls)", () => {
    expect(shouldConsumeProjectile("ignored", false)).toBe(true);
  });

  it("passes through sensors that don't land (pickup zones)", () => {
    expect(shouldConsumeProjectile("ignored", true)).toBe(false);
  });
});
