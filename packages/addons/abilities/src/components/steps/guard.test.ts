import { describe, expect, it, vi } from "vitest";
import { ProcessComponent, Vec2, createMockEntity } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { Abilities } from "../../core/Abilities.js";
import type { Hit } from "../../core/hit/types.js";
import { HitReceiver } from "../HitReceiver.js";
import { block, guard, parry } from "./guard.js";

// HitReceiver's default steps pull in Stagger, whose RigidBodyComponent
// import can't resolve Rapier headless — stub the class (no Stagger here).
vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");
  class RigidBodyComponent extends core.Component {
    setVelocity(): void {}
  }
  return { RigidBodyComponent };
});

function setup() {
  const { entity } = createMockEntity("guardian");
  const pc = entity.add(new ProcessComponent());
  const receiver = entity.add(new HitReceiver());
  return { entity, pc, receiver };
}

function makeHit(source: Entity): Hit {
  return { source, direction: new Vec2(1, 0), tags: [], data: {} };
}

describe("guard step", () => {
  it("opens the guard at `from`, closes it at `to`", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        {
          id: "block",
          timeline: [
            guard({
              from: 0.1,
              to: 0.3,
              outcome: "blocked",
              policy: () => "negate",
            }),
          ],
        },
      ]),
    );

    expect(receiver.receive(makeHit(attacker))).toBe("hit"); // before the window
    abilities.send("block");
    pc._tick(0.1); // enter fires
    expect(receiver.receive(makeHit(attacker))).toBe("blocked");
    pc._tick(0.2); // exit fires
    expect(receiver.receive(makeHit(attacker))).toBe("hit"); // after the window
  });

  it("cancel closes the guard early", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        {
          id: "block",
          timeline: [
            guard({
              from: 0,
              to: 1,
              outcome: "blocked",
              policy: () => "negate",
            }),
          ],
        },
      ]),
    );

    abilities.send("block");
    pc._tick(0.1);
    expect(receiver.receive(makeHit(attacker))).toBe("blocked");
    abilities.cancel();
    expect(receiver.receive(makeHit(attacker))).toBe("hit");
  });

  it("closes an open guard while abilities are dormant and restores it on enable", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        {
          id: "block",
          timeline: [
            guard({
              from: 0,
              to: 1,
              outcome: "blocked",
              policy: () => "negate",
            }),
          ],
        },
      ]),
    );

    abilities.send("block");
    pc._tick(0.1);
    expect(receiver.receive(makeHit(attacker))).toBe("blocked");

    abilities.enabled = false;
    expect(receiver.receive(makeHit(attacker))).toBe("hit");

    abilities.enabled = true;
    expect(receiver.receive(makeHit(attacker))).toBe("blocked");
  });

  it("throws on an entity with no HitReceiver", () => {
    const { entity } = createMockEntity("no-receiver");
    const pc = entity.add(new ProcessComponent());
    const abilities = entity.add(
      new Abilities([
        {
          id: "block",
          timeline: [
            guard({
              from: 0,
              to: 0.1,
              outcome: "blocked",
              policy: () => "negate",
            }),
          ],
        },
      ]),
    );

    abilities.send("block");
    expect(() => pc._tick(0.2)).toThrow(
      /step "guard" requires a HitReceiver component/,
    );
  });
});

describe("parry wrapper", () => {
  it("negates every hit in its window, reporting 'parried'", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([{ id: "p", timeline: [parry({ from: 0, to: 1 })] }]),
    );

    abilities.send("p");
    pc._tick(0.1);
    expect(receiver.receive(makeHit(attacker))).toBe("parried");
  });

  it("threads punish onto the guard params, omitting it when unset", () => {
    const withPunish = parry({ from: 0, to: 0.3, punish: { damage: 5 } });
    expect(withPunish.params.punish).toEqual({ damage: 5 });

    const without = parry({ from: 0, to: 0.3 });
    expect("punish" in without.params).toBe(false);
  });

  it('accepts to: "end" like block', () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        { id: "p", duration: 0.3, timeline: [parry({ from: 0, to: "end" })] },
      ]),
    );

    abilities.send("p");
    pc._tick(0.2);
    expect(receiver.receive(makeHit(attacker))).toBe("parried");
    pc._tick(0.1);
    expect(receiver.receive(makeHit(attacker))).toBe("hit");
  });

  it("does not expose interval ticks on guards", () => {
    const invalidCall = (): void => {
      guard({
        from: 0,
        to: 1,
        outcome: "blocked",
        policy: () => "negate",
        // @ts-expect-error guards engage on incoming hits, not timeline intervals
        every: 0.1,
      });
    };
    expect(invalidCall).toBeTypeOf("function");
  });
});

describe("block wrapper", () => {
  function makeStandardHit(source: Entity): Hit {
    return {
      source,
      direction: new Vec2(1, 0),
      tags: [],
      data: { damage: 10, knockback: 100, stun: 1 },
    };
  }

  it("scales the hit in place and lets it land as a hit", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        {
          id: "b",
          timeline: [
            block({ from: 0, to: 1, damageScale: 0.5, knockbackScale: 0.25 }),
          ],
        },
      ]),
    );

    abilities.send("b");
    pc._tick(0.1);
    const hit = makeStandardHit(attacker);
    expect(receiver.receive(hit)).toBe("hit");
    // stunScale defaults to 0 — a blocked hit never stuns unless opted in.
    expect(hit.data).toEqual({ damage: 5, knockback: 25, stun: 0 });
  });

  it("fully mitigates when no scales are given", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([{ id: "b", timeline: [block({ from: 0, to: 1 })] }]),
    );

    abilities.send("b");
    pc._tick(0.1);
    const hit = makeStandardHit(attacker);
    expect(receiver.receive(hit)).toBe("hit");
    expect(hit.data).toEqual({ damage: 0, knockback: 0, stun: 0 });
  });
});
