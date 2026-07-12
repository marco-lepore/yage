import { describe, expect, it, vi } from "vitest";
import { ProcessComponent, Vec2, createMockEntity } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { Abilities } from "../../core/Abilities.js";
import type { Hit } from "../../core/hit/types.js";
import { HitReceiver } from "../HitReceiver.js";
import { guard } from "./guard.js";

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
    abilities.play("block");
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

    abilities.play("block");
    pc._tick(0.1);
    expect(receiver.receive(makeHit(attacker))).toBe("blocked");
    abilities.cancel();
    expect(receiver.receive(makeHit(attacker))).toBe("hit");
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

    abilities.play("block");
    expect(() => pc._tick(0.2)).toThrow(
      /step "guard" requires a HitReceiver component/,
    );
  });
});
