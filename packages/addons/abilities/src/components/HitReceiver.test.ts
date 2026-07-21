import { describe, expect, it, vi } from "vitest";
import {
  Entity,
  Transform,
  Vec2,
  createMockEntity,
  createMockScene,
  trait,
} from "@yagejs/core";
import { HitGuarded, HitReceived, HitReceiver } from "./HitReceiver.js";
import type {
  GuardParams,
  HitReceivedPayload,
  HitReceiverOptions,
} from "./HitReceiver.js";
import { Health } from "./Health.js";
import { HitDealt } from "./reportedDelivery.js";
import { Hittable } from "../core/hit/types.js";
import type { Hit, HitResult } from "../core/hit/types.js";

// A Hittable target for the punish-delivery tests below: the attacker must
// itself have the trait for `HitReceiver`'s punish delivery to land.
@trait(Hittable)
class PunishTarget extends Entity {
  received: Hit[] = [];
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return "hit";
  }
}

// The default steps pull in Stagger, whose RigidBodyComponent import can't
// resolve Rapier headless — stub the class (no Stagger is used here).
vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");
  class RigidBodyComponent extends core.Component {
    setVelocity(): void {}
  }
  return { RigidBodyComponent };
});

function setup(options?: HitReceiverOptions) {
  const { entity } = createMockEntity("victim");
  const receiver = entity.add(new HitReceiver(options));
  const received: Hit[] = [];
  const receivedPayloads: HitReceivedPayload[] = [];
  const guarded: Array<{ hit: Hit; outcome: HitResult }> = [];
  entity.on(HitReceived, (payload) => {
    received.push(payload.hit);
    receivedPayloads.push(payload);
  });
  entity.on(HitGuarded, (e) => guarded.push(e));
  return { entity, receiver, received, receivedPayloads, guarded };
}

function makeHit(source: Entity, over: Partial<Hit> = {}): Hit {
  return { source, direction: new Vec2(1, 0), tags: [], data: {}, ...over };
}

function guardParams(over: Partial<GuardParams> = {}): GuardParams {
  return { outcome: "blocked", policy: () => "negate", ...over };
}

describe("HitReceiver — receipt sequence", () => {
  it("lands a hit: runs steps in order, emits HitReceived, returns 'hit'", () => {
    const order: string[] = [];
    const { receiver, received } = setup({
      steps: [
        () => {
          order.push("a");
        },
        () => {
          order.push("b");
        },
      ],
    });
    const { entity: attacker } = createMockEntity("attacker");
    const hit = makeHit(attacker);

    expect(receiver.receive(hit)).toBe("hit");
    expect(order).toEqual(["a", "b"]);
    expect(received).toEqual([hit]);
  });

  it("steps receive the hit and the receiver", () => {
    const seen: Array<{ hit: Hit; receiver: HitReceiver }> = [];
    const { entity, receiver } = setup({
      steps: [
        (hit, r) => {
          seen.push({ hit, receiver: r });
        },
      ],
    });
    const { entity: attacker } = createMockEntity("attacker");
    const hit = makeHit(attacker);

    receiver.receive(hit);
    expect(seen).toEqual([{ hit, receiver }]);
    expect(seen[0]!.receiver.entity).toBe(entity);
  });
});

describe("HitReceiver — team filter", () => {
  it("rejects same-team hits by default: no steps, no event", () => {
    let steps = 0;
    const { receiver, received } = setup({
      team: "enemy",
      steps: [
        () => {
          steps++;
        },
      ],
    });
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker, { team: "enemy" }))).toBe(
      "ignored",
    );
    expect(steps).toBe(0);
    expect(received).toEqual([]);
  });

  it("accepts cross-team and teamless combinations", () => {
    const { receiver } = setup({ team: "enemy" });
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker, { team: "player" }))).toBe("hit");
    expect(receiver.receive(makeHit(attacker))).toBe("hit");

    const { receiver: teamless } = setup();
    expect(teamless.receive(makeHit(attacker, { team: "enemy" }))).toBe("hit");
  });

  it("a custom filter replaces the default (friendly fire on)", () => {
    const { receiver } = setup({ team: "enemy", filter: () => true });
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker, { team: "enemy" }))).toBe("hit");
  });

  it("team is writable at runtime", () => {
    const { receiver } = setup({ team: "enemy" });
    const { entity: attacker } = createMockEntity("attacker");

    receiver.team = "player";
    expect(receiver.receive(makeHit(attacker, { team: "enemy" }))).toBe("hit");
    expect(receiver.receive(makeHit(attacker, { team: "player" }))).toBe(
      "ignored",
    );
  });
});

describe("HitReceiver — i-frames", () => {
  it("gates ALL receipt after a landed hit, and reopens once elapsed", () => {
    let steps = 0;
    const { receiver, received } = setup({
      iframes: 0.5,
      steps: [
        () => {
          steps++;
        },
      ],
    });
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker))).toBe("hit");
    expect(receiver.iframesRemaining).toBe(0.5);

    expect(receiver.receive(makeHit(attacker))).toBe("ignored");
    receiver.update(0.3);
    expect(receiver.receive(makeHit(attacker))).toBe("ignored");
    expect(steps).toBe(1);
    expect(received).toHaveLength(1);

    receiver.update(0.2);
    expect(receiver.iframesRemaining).toBe(0);
    expect(receiver.receive(makeHit(attacker))).toBe("hit");
    expect(steps).toBe(2);
  });

  it("filtered hits don't consume anything while i-frames are down", () => {
    const { receiver } = setup({ team: "enemy", iframes: 0.5 });
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker, { team: "enemy" }))).toBe(
      "ignored",
    );
    expect(receiver.iframesRemaining).toBe(0);
  });
});

describe("HitReceiver — manual invulnerability", () => {
  it("an open invulnerability window ignores every hit regardless of team or steps", () => {
    let steps = 0;
    const { receiver } = setup({
      steps: [
        () => {
          steps++;
        },
      ],
    });
    const { entity: attacker } = createMockEntity("attacker");

    const key = {};
    receiver.openInvulnerability(key);
    expect(receiver.receive(makeHit(attacker))).toBe("ignored");
    expect(steps).toBe(0);
  });

  it("closing the window reopens receipt", () => {
    const { receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");

    const key = {};
    receiver.openInvulnerability(key);
    receiver.closeInvulnerability(key);
    expect(receiver.receive(makeHit(attacker))).toBe("hit");
  });

  it("overlapping windows keep receipt closed until every key closes", () => {
    const { receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");

    const dodge = {};
    const wakeUp = {};
    receiver.openInvulnerability(dodge);
    receiver.openInvulnerability(wakeUp);
    receiver.closeInvulnerability(dodge);
    expect(receiver.receive(makeHit(attacker))).toBe("ignored");
    receiver.closeInvulnerability(wakeUp);
    expect(receiver.receive(makeHit(attacker))).toBe("hit");
  });
});

describe("HitReceiver — isInvulnerable", () => {
  it("false when neither source is armed", () => {
    const { receiver } = setup();
    expect(receiver.isInvulnerable).toBe(false);
  });

  it("true while a manual invulnerability window is open", () => {
    const { receiver } = setup();
    const key = {};
    receiver.openInvulnerability(key);
    expect(receiver.isInvulnerable).toBe(true);
    receiver.closeInvulnerability(key);
    expect(receiver.isInvulnerable).toBe(false);
  });

  it("true while post-hit i-frames are armed", () => {
    const { receiver } = setup({ iframes: 0.5 });
    const { entity: attacker } = createMockEntity("attacker");

    receiver.receive(makeHit(attacker));
    expect(receiver.isInvulnerable).toBe(true);
    receiver.update(0.5);
    expect(receiver.isInvulnerable).toBe(false);
  });

  it("stays true when both sources are armed at once, until the last one clears", () => {
    const { receiver } = setup({ iframes: 0.5 });
    const { entity: attacker } = createMockEntity("attacker");

    receiver.receive(makeHit(attacker)); // arms i-frames
    const key = {};
    receiver.openInvulnerability(key);
    receiver.update(0.5); // i-frames elapse; the manual window is still open
    expect(receiver.isInvulnerable).toBe(true);
    receiver.closeInvulnerability(key);
    expect(receiver.isInvulnerable).toBe(false);
  });
});

describe("HitReceiver — guards", () => {
  it("a 'negate' verdict ends resolution with the guard's outcome label; apply steps don't run", () => {
    let steps = 0;
    const { receiver } = setup({
      steps: [
        () => {
          steps++;
        },
      ],
    });
    receiver.openGuard(guardParams({ outcome: "parried" }));
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker))).toBe("parried");
    expect(steps).toBe(0);
  });

  it("a 'pass' verdict continues resolution to the apply stages", () => {
    let steps = 0;
    const { receiver } = setup({
      steps: [
        () => {
          steps++;
        },
      ],
    });
    receiver.openGuard(guardParams({ policy: () => "pass" }));
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker))).toBe("hit");
    expect(steps).toBe(1);
  });

  it("a 'modified' verdict mutates hit.data in place and still resolves to 'hit'", () => {
    const { entity, receiver } = setup();
    const health = entity.add(new Health({ max: 10 }));
    receiver.openGuard(
      guardParams({
        policy: (hit) => {
          hit.data.damage = (hit.data.damage ?? 0) / 2;
          return "modified";
        },
      }),
    );
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker, { data: { damage: 10 } }))).toBe(
      "hit",
    );
    expect(health.hp).toBe(5);
  });

  it("multiple open guards evaluate in open order; a negate ends resolution", () => {
    const seen: string[] = [];
    const { receiver } = setup();
    receiver.openGuard(
      guardParams({
        outcome: "blocked",
        policy: () => {
          seen.push("first");
          return "pass";
        },
      }),
    );
    receiver.openGuard(
      guardParams({
        outcome: "parried",
        policy: () => {
          seen.push("second");
          return "negate";
        },
      }),
    );
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker))).toBe("parried");
    expect(seen).toEqual(["first", "second"]);
  });

  it("closeGuard removes a guard from evaluation", () => {
    const { receiver } = setup();
    const params = guardParams();
    receiver.openGuard(params);
    receiver.closeGuard(params);
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker))).toBe("hit");
  });

  it("team filtering runs before guards: a same-team hit never reaches one", () => {
    let policyCalls = 0;
    const { receiver } = setup({ team: "enemy" });
    receiver.openGuard(
      guardParams({
        policy: () => {
          policyCalls++;
          return "negate";
        },
      }),
    );
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker, { team: "enemy" }))).toBe(
      "ignored",
    );
    expect(policyCalls).toBe(0);
  });

  it("i-frames don't arm on a blocked/parried result; HitReceived doesn't emit", () => {
    const { receiver, received } = setup({ iframes: 0.5 });
    receiver.openGuard(guardParams());
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker))).toBe("blocked");
    expect(receiver.iframesRemaining).toBe(0);
    expect(received).toEqual([]);
  });

  it("emits HitGuarded after the fold completes, whenever a guard engaged", () => {
    const { receiver, guarded } = setup();
    receiver.openGuard(guardParams({ outcome: "blocked" }));
    const { entity: attacker } = createMockEntity("attacker");
    const hit = makeHit(attacker);

    receiver.receive(hit);
    expect(guarded).toEqual([{ hit, outcome: "blocked" }]);
  });

  it("includes every engaged guard outcome when a modified hit lands", () => {
    const { receiver, receivedPayloads } = setup({ steps: [] });
    receiver.openGuard(
      guardParams({ outcome: "blocked", policy: () => "modified" }),
    );
    receiver.openGuard(
      guardParams({ outcome: "parried", policy: () => "modified" }),
    );
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker))).toBe("hit");
    expect(receivedPayloads[0]?.guardOutcomes).toEqual(["blocked", "parried"]);
  });

  it("delivers a guard's punish to the attacker post-fold (direction defender→attacker)", () => {
    const { entity, receiver } = setup();
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const { scene } = createMockScene();
    const attacker = scene.spawn(PunishTarget);
    attacker.add(new Transform({ position: new Vec2(5, 0) }));

    receiver.openGuard(
      guardParams({ outcome: "parried", punish: { stun: 0.2 } }),
    );

    receiver.receive(makeHit(attacker));

    expect(attacker.received).toHaveLength(1);
    expect(attacker.received[0]!.data).toEqual({ stun: 0.2 });
    expect(attacker.received[0]!.direction.x).toBeCloseTo(1); // defender(0,0) → attacker(5,0)
  });

  it("every engaged guard reports and punishes: a modified block and a negating parry both fire, in engage order", () => {
    const { entity, receiver, guarded } = setup();
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const { scene } = createMockScene();
    const attacker = scene.spawn(PunishTarget);
    attacker.add(new Transform({ position: new Vec2(5, 0) }));

    receiver.openGuard(
      guardParams({
        outcome: "blocked",
        policy: (hit) => {
          hit.data.damage = (hit.data.damage ?? 0) / 2;
          return "modified";
        },
        punish: { knockback: 50 },
      }),
    );
    receiver.openGuard(
      guardParams({ outcome: "parried", punish: { stun: 0.2 } }),
    );

    expect(receiver.receive(makeHit(attacker, { data: { damage: 10 } }))).toBe(
      "parried",
    );
    expect(guarded.map((e) => e.outcome)).toEqual(["blocked", "parried"]);
    expect(attacker.received.map((p) => p.data)).toEqual([
      { knockback: 50 },
      { stun: 0.2 },
    ]);
  });

  it("a non-Hittable attacker makes the punish a no-op", () => {
    const { entity, receiver } = setup();
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const { entity: attackerEntity } = createMockEntity("attacker");

    receiver.openGuard(
      guardParams({ outcome: "blocked", punish: { stun: 0.2 } }),
    );

    expect(() => receiver.receive(makeHit(attackerEntity))).not.toThrow();
  });

  it("a punish delivery emits HitDealt on the defender", () => {
    const { entity, receiver } = setup();
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const { scene } = createMockScene();
    const attacker = scene.spawn(PunishTarget);
    attacker.add(new Transform({ position: new Vec2(5, 0) }));
    const dealt: unknown[] = [];
    entity.on(HitDealt, (payload) => dealt.push(payload));

    receiver.openGuard(
      guardParams({ outcome: "parried", punish: { stun: 0.2 } }),
    );
    receiver.receive(makeHit(attacker));

    expect(attacker.received).toHaveLength(1);
    expect(dealt).toHaveLength(1);
    expect(dealt[0]).toMatchObject({
      target: attacker,
      result: "hit",
      data: { stun: 0.2 },
    });
  });
});

describe("HitReceiver — default steps", () => {
  it("applies StandardHitData.damage through a sibling Health", () => {
    const { entity, receiver } = setup();
    const health = entity.add(new Health({ max: 10 }));
    const { entity: attacker } = createMockEntity("attacker");

    expect(receiver.receive(makeHit(attacker, { data: { damage: 3 } }))).toBe(
      "hit",
    );
    expect(health.hp).toBe(7);
  });

  it("lands without consequence components present (no Health, no Stagger)", () => {
    const { receiver, received } = setup();
    const { entity: attacker } = createMockEntity("attacker");

    expect(
      receiver.receive(
        makeHit(attacker, { data: { damage: 3, knockback: 100, stun: 0.2 } }),
      ),
    ).toBe("hit");
    expect(received).toHaveLength(1);
  });
});
