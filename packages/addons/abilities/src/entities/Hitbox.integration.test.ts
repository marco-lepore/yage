import { describe, expect, it, vi } from "vitest";

vi.mock("@dimforge/rapier2d", async () => {
  const mod = await import("@dimforge/rapier2d-compat");
  await mod.default.init();
  return { default: mod.default };
});

import { Entity, Transform, Vec2, createMockScene, trait } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorld,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import type { ColliderConfig } from "@yagejs/physics";
import { Hittable } from "../core/hit/types.js";
import type { Hit, HitContact, HitResult } from "../core/hit/types.js";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitDelivery } from "../core/hit/delivery.js";
import {
  HitDealt,
  createReportingDelivery,
} from "../components/reportedDelivery.js";
import { Hitbox } from "./Hitbox.js";
import type { HitboxConfig } from "./Hitbox.js";

@trait(Hittable)
class Target extends Entity {
  received: Hit[] = [];
  dieOnHit = false;
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    if (this.dieOnHit) this.destroy();
    return "hit";
  }
}

const BODY: ColliderConfig = { shape: { type: "box", width: 20, height: 20 } };

function spawnTarget(
  scene: Scene,
  x: number,
  y: number,
  collider: ColliderConfig = BODY,
): Target {
  const target = scene.spawn(Target);
  target.add(new Transform({ position: new Vec2(x, y) }));
  target.add(new RigidBodyComponent({ type: "kinematic" }));
  target.add(new ColliderComponent(collider));
  return target;
}

/** A 40×20 swing box reaching 10..50px ahead of the caster along the aim. */
function spawnSwing(
  scene: Scene,
  delivery: HitDelivery,
  overrides: Partial<HitboxConfig> = {},
): Hitbox {
  return scene.spawn(Hitbox, {
    position: { x: 0, y: 0 },
    rotation: 0,
    shape: { type: "box", width: 40, height: 20 },
    offset: { x: 30, y: 0 },
    delivery,
    ...overrides,
  });
}

function setup() {
  const { scene } = createMockScene();
  const world = new PhysicsWorld();
  scene._registerScoped(PhysicsWorldKey, world);
  const source = scene.spawn("attacker");
  const delivery = createHitDelivery({ source, data: { damage: 5 } });
  const step = (): void => {
    world.step(1 / 60);
    world.processCollisionEvents();
  };
  return { scene, world, source, delivery, step };
}

function expectUnit(contact: HitContact | undefined): HitContact {
  expect(contact).toBeDefined();
  for (const n of [
    contact!.point.x,
    contact!.point.y,
    contact!.normal.x,
    contact!.normal.y,
  ]) {
    expect(Number.isFinite(n)).toBe(true);
  }
  expect(contact!.normal.length()).toBeCloseTo(1, 5);
  return contact!;
}

describe("Hitbox contact geometry with real physics", () => {
  it("reports the struck face of a target ahead of a right-facing swing, keeping direction", () => {
    const { scene, delivery, step } = setup();
    spawnSwing(scene, delivery);
    const target = spawnTarget(scene, 55, 0); // faces at x = 45..65
    step();

    const hit = target.received[0]!;
    const contact = expectUnit(hit.contact);
    expect(contact.point.x).toBeCloseTo(45, 4);
    expect(contact.normal.x).toBeCloseTo(-1, 5); // out of the target, toward the swing
    expect(hit.direction.x).toBeCloseTo(1, 5); // from the caster toward the target
  });

  it("reports the struck face for a left-facing swing with the same local offset", () => {
    const { scene, delivery, step } = setup();
    spawnSwing(scene, delivery, { rotation: Math.PI });
    const target = spawnTarget(scene, -55, 0); // faces at x = -65..-45
    step();

    const hit = target.received[0]!;
    const contact = expectUnit(hit.contact);
    expect(contact.point.x).toBeCloseTo(-45, 4);
    expect(contact.normal.x).toBeCloseTo(1, 5);
    expect(hit.direction.x).toBeCloseTo(-1, 5);
  });

  it("still reports a surface point for a target the window opens already inside", () => {
    const { scene, delivery, step } = setup();
    spawnSwing(scene, delivery);
    const target = spawnTarget(scene, 30, 0); // wholly inside the swing box
    step();

    const contact = expectUnit(target.received[0]!.contact);
    // A face of the target, not its centre.
    const onVerticalFace = Math.abs(Math.abs(contact.point.x - 30) - 10) < 1e-4;
    const onHorizontalFace = Math.abs(Math.abs(contact.point.y) - 10) < 1e-4;
    expect(onVerticalFace || onHorizontalFace).toBe(true);
  });

  it("measures the collider part that fired the trigger on a compound target", () => {
    const { scene, delivery, step } = setup();
    // 20×20 sensor at x 5..25, y -50..-30: overlaps only the head circle
    // (part 1, centred at (0,-40), radius 10), never the body box (part 0).
    spawnSwing(scene, delivery, {
      position: { x: 15, y: -40 },
      shape: { type: "box", width: 20, height: 20 },
      offset: { x: 0, y: 0 },
    });
    const target = spawnTarget(scene, 0, 0, {
      parts: [
        { shape: { type: "box", width: 20, height: 20 } },
        { shape: { type: "circle", radius: 10 }, offset: { x: 0, y: -40 } },
      ],
    });
    step();

    const contact = expectUnit(target.received[0]!.contact);
    expect(contact.point.x).toBeCloseTo(10, 4); // the head's right edge
    expect(contact.point.y).toBeCloseTo(-40, 4);
    expect(contact.normal.x).toBeCloseTo(1, 5); // out of the head, toward the sensor
  });

  it("keeps the contact on HitDealt for a hit that kills the target", () => {
    const { scene, source, step } = setup();
    const dealt: { contact?: HitContact }[] = [];
    source.on(HitDealt, (payload) => dealt.push(payload));
    spawnSwing(scene, createReportingDelivery({ source, data: { damage: 5 } }));
    const target = spawnTarget(scene, 55, 0);
    target.dieOnHit = true;
    step();
    scene._flushDestroyQueue();

    expect(target.isDestroyed).toBe(true);
    expect(dealt).toHaveLength(1);
    const contact = expectUnit(dealt[0]!.contact);
    expect(contact.point.x).toBeCloseTo(45, 4);
  });
});
