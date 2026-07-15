import { describe, expect, it, vi } from "vitest";
import { ProcessComponent, Vec2, createMockEntity } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { Abilities } from "../../core/Abilities.js";
import type { Hit } from "../../core/hit/types.js";
import { HitReceiver } from "../HitReceiver.js";
import { invulnerable } from "./invulnerable.js";

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
  const { entity } = createMockEntity("dodger");
  const pc = entity.add(new ProcessComponent());
  const receiver = entity.add(new HitReceiver({ team: "player" }));
  return { entity, pc, receiver };
}

function makeHit(source: Entity, team?: string): Hit {
  return {
    source,
    direction: new Vec2(1, 0),
    tags: [],
    data: {},
    ...(team !== undefined ? { team } : {}),
  };
}

describe("invulnerable step", () => {
  it("ignores every hit while the window is open, even cross-team ones", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        { id: "dodge", timeline: [invulnerable({ from: 0.1, to: 0.3 })] },
      ]),
    );

    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("hit");
    abilities.play("dodge");
    pc._tick(0.1);
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("ignored");
    pc._tick(0.2);
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("hit");
  });

  it("cancel closes the window early", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        { id: "dodge", timeline: [invulnerable({ from: 0, to: 1 })] },
      ]),
    );

    abilities.play("dodge");
    pc._tick(0.1);
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("ignored");
    abilities.cancel();
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("hit");
  });

  it("overlapping windows in one timeline stay protected until the last closes", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    const abilities = entity.add(
      new Abilities([
        {
          id: "dodge",
          timeline: [
            invulnerable({ from: 0, to: 0.5 }),
            invulnerable({ from: 0.2, to: 1 }),
          ],
        },
      ]),
    );

    abilities.play("dodge");
    pc._tick(0.6); // first window closed, second still open
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("ignored");
    pc._tick(0.5); // past t=1 — both closed
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("hit");
  });

  it("two concurrent lanes reusing the same step object don't close each other's window", () => {
    const { entity, pc, receiver } = setup();
    const { entity: attacker } = createMockEntity("attacker");
    // One `invulnerable(...)` value shared across two defs in different
    // lanes — a game might do this to keep a shared window definition in
    // one place. Each lane's own `enter`/`exit` must still be independent.
    const sharedWindow = invulnerable({ from: 0, to: 1 });
    const abilities = entity.add(
      new Abilities([
        { id: "a", lane: "main", timeline: [sharedWindow] },
        { id: "b", lane: "side", timeline: [sharedWindow] },
      ]),
    );

    abilities.play("a");
    abilities.play("b");
    pc._tick(0.1); // both enter
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("ignored");

    abilities.cancel("main"); // closes only lane "a"'s window
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("ignored"); // lane "b" still open

    abilities.cancel("side");
    expect(receiver.receive(makeHit(attacker, "enemy"))).toBe("hit");
  });

  it("throws on an entity with no HitReceiver", () => {
    const { entity } = createMockEntity("no-receiver");
    const pc = entity.add(new ProcessComponent());
    const abilities = entity.add(
      new Abilities([
        { id: "dodge", timeline: [invulnerable({ from: 0, to: 0.1 })] },
      ]),
    );

    abilities.play("dodge");
    expect(() => pc._tick(0.2)).toThrow(
      /step "invulnerable" requires a HitReceiver component/,
    );
  });
});
