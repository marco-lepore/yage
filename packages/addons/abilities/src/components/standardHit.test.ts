import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  createMockScene,
  trait,
} from "@yagejs/core";
import { RigidBodyComponent } from "@yagejs/physics";
import { damageStep, reactionStep } from "./standardHit.js";
import { HitReceived, HitReceiver } from "./HitReceiver.js";
import { Health } from "./Health.js";
import { Stagger } from "./Stagger.js";
import { Abilities } from "../core/Abilities.js";
import { defineStep } from "../core/defineStep.js";
import type { AbilityDef } from "../core/types.js";
import { Hittable } from "../core/hit/types.js";
import type { Hit, HitResult } from "../core/hit/types.js";
import { createHitDelivery } from "../core/hit/delivery.js";

// Stagger only calls `setVelocity` on its sibling body; a real
// RigidBodyComponent needs a live Rapier world, so the class is replaced
// with a velocity recorder.
const captured = vi.hoisted(() => ({
  velocities: [] as { x: number; y: number }[],
}));
vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");
  class RigidBodyComponent extends core.Component {
    setVelocity(v: { x: number; y: number }): void {
      captured.velocities.push({ x: v.x, y: v.y });
    }
  }
  return { RigidBodyComponent };
});

@trait(Hittable)
class Victim extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }
}

function spawnVictim(opts: { hp: number; team?: string }) {
  const { scene } = createMockScene();
  const victim = scene.spawn(Victim);
  victim.add(new Transform({ position: new Vec2(10, 0) }));
  victim.add(new RigidBodyComponent({ type: "dynamic" }));
  const health = victim.add(new Health({ max: opts.hp }));
  const stagger = victim.add(new Stagger());
  const receiver = victim.add(
    new HitReceiver(opts.team !== undefined ? { team: opts.team } : {}),
  );
  return { scene, victim, health, stagger, receiver };
}

function makeHit(source: Entity, data: Hit["data"]): Hit {
  return { source, direction: new Vec2(0, 1), tags: [], data };
}

beforeEach(() => {
  captured.velocities.length = 0;
});

describe("default receipt steps", () => {
  it("damageStep applies damage through Health and skips absent/zero fields", () => {
    const { scene, health, receiver } = spawnVictim({ hp: 10 });
    const attacker = scene.spawn("attacker");

    damageStep(makeHit(attacker, { damage: 4 }), receiver);
    expect(health.hp).toBe(6);

    damageStep(makeHit(attacker, {}), receiver);
    damageStep(makeHit(attacker, { damage: 0 }), receiver);
    expect(health.hp).toBe(6);
  });

  it("reactionStep drives Stagger from knockback/stun along the hit direction", () => {
    const { scene, stagger, receiver } = spawnVictim({ hp: 10 });
    const attacker = scene.spawn("attacker");

    reactionStep(makeHit(attacker, { knockback: 100, stun: 0.2 }), receiver);
    expect(stagger.active).toBe(true);
    expect(captured.velocities).toEqual([{ x: 0, y: 100 }]);
  });

  it("reactionStep does nothing without knockback or stun", () => {
    const { scene, stagger, receiver } = spawnVictim({ hp: 10 });
    const attacker = scene.spawn("attacker");

    reactionStep(makeHit(attacker, { damage: 2 }), receiver);
    expect(stagger.active).toBe(false);
    expect(captured.velocities).toEqual([]);
  });

  it("a killing blow doesn't shove the corpse: damage runs first, then reaction sees the dead entity", () => {
    const { scene, victim, health, stagger } = spawnVictim({ hp: 3 });
    const attacker = scene.spawn("attacker");
    const receiver = victim.get(HitReceiver);

    const result = receiver.receive(
      makeHit(attacker, { damage: 5, knockback: 100, stun: 0.2 }),
    );
    expect(result).toBe("hit");
    expect(health.isDead).toBe(true);
    expect(stagger.active).toBe(false);
    expect(captured.velocities).toEqual([]);
  });
});

describe("reactionStep with a sibling Abilities", () => {
  function spawnVictimWithAbilities(opts: {
    hp: number;
    defs?: readonly AbilityDef[];
  }) {
    const base = spawnVictim({ hp: opts.hp });
    const pc = base.victim.add(new ProcessComponent());
    const abilities = base.victim.add(
      new Abilities(opts.defs ?? [{ id: "swing", timeline: [] }]),
    );
    return { ...base, pc, abilities };
  }

  it("forces the stagger reaction, occupying the main lane for `stun` seconds", () => {
    const { scene, receiver, pc, abilities } = spawnVictimWithAbilities({
      hp: 10,
    });
    const attacker = scene.spawn("attacker");

    reactionStep(makeHit(attacker, { knockback: 100, stun: 0.2 }), receiver);
    expect(abilities.isActive()).toBe(true);
    expect(abilities.activeId()).toBe("stagger");

    pc._tick(0.01); // fires the reaction's enter hook
    expect(captured.velocities).toEqual([{ x: 0, y: 100 }]);

    pc._tick(0.2);
    expect(abilities.isActive()).toBe(false);
  });

  it("interrupts the victim's in-flight ability: its open windows exit cancelled", () => {
    const exits: boolean[] = [];
    const swingWindow = defineStep<object>("swingWindow", {
      exit: (_params, _ctx, cancelled) => {
        exits.push(cancelled);
      },
    });
    const { scene, receiver, pc, abilities } = spawnVictimWithAbilities({
      hp: 10,
      defs: [{ id: "swing", timeline: [swingWindow({ from: 0, to: 0.5 })] }],
    });
    const attacker = scene.spawn("attacker");

    expect(abilities.play("swing")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    pc._tick(0.01); // opens the swing's window

    reactionStep(makeHit(attacker, { knockback: 100, stun: 0.2 }), receiver);
    expect(exits).toEqual([true]);
    expect(abilities.activeId()).toBe("stagger");
  });

  it("a priority-0 play is refused while the forced reaction is active", () => {
    const { scene, receiver, abilities } = spawnVictimWithAbilities({
      hp: 10,
    });
    const attacker = scene.spawn("attacker");

    reactionStep(makeHit(attacker, { knockback: 100, stun: 0.2 }), receiver);
    expect(abilities.play("swing")).toEqual({ ok: false, reason: "busy" });
  });
});

describe("full chain: delivery → trait → receiver → consequences", () => {
  it("a delivered hit damages, staggers, and emits HitReceived", () => {
    const { scene, victim, health, stagger } = spawnVictim({
      hp: 10,
      team: "enemy",
    });
    const attacker = scene.spawn("attacker");
    const received: Hit[] = [];
    victim.on(HitReceived, (hit) => received.push(hit));

    const delivery = createHitDelivery({
      source: attacker,
      team: "player",
      data: { damage: 3, knockback: 100, stun: 0.2 },
    });
    expect(delivery.deliver(victim, new Vec2(0, 0))).toBe("hit");

    expect(health.hp).toBe(7);
    expect(stagger.active).toBe(true);
    expect(captured.velocities).toEqual([{ x: 100, y: 0 }]); // direction: attacker → victim
    expect(received).toHaveLength(1);
    expect(received[0]!.team).toBe("player");
  });

  it("a same-team delivery is filtered out receiver-side", () => {
    const { scene, victim, health } = spawnVictim({ hp: 10, team: "enemy" });
    const attacker = scene.spawn("attacker");

    const delivery = createHitDelivery({
      source: attacker,
      team: "enemy",
      data: { damage: 3 },
    });
    expect(delivery.deliver(victim, new Vec2(0, 0))).toBe("ignored");
    expect(health.hp).toBe(10);
  });
});
