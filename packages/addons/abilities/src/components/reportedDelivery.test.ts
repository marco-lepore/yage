import { describe, expect, it, vi } from "vitest";
import { Entity, Transform, Vec2, createMockScene, trait } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { Hittable } from "../core/hit/types.js";
import type { HitResult } from "../core/hit/types.js";
import type { Hit } from "../core/hit/types.js";
import { createHitDelivery } from "../core/hit/delivery.js";
import { HitReceiver } from "./HitReceiver.js";
import { HitDealt, createReportingDelivery } from "./reportedDelivery.js";

vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");
  class RigidBodyComponent extends core.Component {
    setVelocity(): void {}
  }
  return { RigidBodyComponent };
});

@trait(Hittable)
class Target extends Entity {
  result: HitResult = "hit";
  received: Hit[] = [];
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
    expect(events).toEqual([{ target, result: "hit", data: {} }]);
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

  it("carries the resolved hit data in the payload", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const target = spawnTarget(scene, 10, 0);
    const events: unknown[] = [];
    source.on(HitDealt, (payload) => events.push(payload.data));
    const delivery = createReportingDelivery({
      source,
      data: { damage: 7, hitstop: 0.12 },
    });

    delivery.deliver(target, new Vec2(0, 0));

    expect(events).toEqual([{ damage: 7, hitstop: 0.12 }]);
  });

  it("emits a fire-time copy of the data, independent of the per-victim payload", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const authored = { damage: 5 };
    const dealt: Record<string, unknown>[] = [];
    source.on(HitDealt, (payload) =>
      dealt.push(payload.data as Record<string, unknown>),
    );
    const delivery = createReportingDelivery({ source, data: authored });

    const target = spawnTarget(scene, 10, 0);
    delivery.deliver(target, new Vec2(0, 0));

    // The reported data is a copy, not the authored object.
    expect(dealt[0]).not.toBe(authored);
    expect(dealt[0]).toEqual({ damage: 5 });
  });

  it("stamps the ability provenance when given, omits it otherwise", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const withProv: { ability?: unknown }[] = [];
    source.on(HitDealt, (payload) => withProv.push(payload));

    const def = { id: "swing", timeline: [] };
    const reporting = createReportingDelivery({ source }, { ability: def });
    reporting.deliver(spawnTarget(scene, 10, 0), new Vec2(0, 0));
    expect(withProv[0]!.ability).toBe(def);

    const plain = createReportingDelivery({ source });
    plain.deliver(spawnTarget(scene, 10, 0), new Vec2(0, 0));
    expect("ability" in withProv[1]!).toBe(false);
  });

  it("inherits the source HitReceiver team and lets an explicit team override it", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    source.add(new HitReceiver({ team: "player", steps: [] }));
    const inheritedTarget = spawnTarget(scene, 10, 0);
    const overrideTarget = spawnTarget(scene, 20, 0);

    createReportingDelivery({ source }).deliver(
      inheritedTarget,
      new Vec2(0, 0),
    );
    createReportingDelivery({ source, team: "boss" }).deliver(
      overrideTarget,
      new Vec2(0, 0),
    );

    expect(inheritedTarget.received[0]?.team).toBe("player");
    expect(overrideTarget.received[0]?.team).toBe("boss");
  });
});
