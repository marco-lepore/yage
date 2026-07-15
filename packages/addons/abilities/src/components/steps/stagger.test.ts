import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessComponent, Vec2, createMockEntity } from "@yagejs/core";
import { RigidBodyComponent } from "@yagejs/physics";
import { Abilities } from "../../core/Abilities.js";
import { defineStep } from "../../core/defineStep.js";
import { Stagger } from "../Stagger.js";
import { REACTION_PRIORITY, staggerReaction } from "./stagger.js";

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

function setup() {
  const { entity } = createMockEntity("victim");
  entity.add(new RigidBodyComponent({ type: "dynamic" }));
  const pc = entity.add(new ProcessComponent());
  const stagger = entity.add(new Stagger());
  return { entity, pc, stagger };
}

beforeEach(() => {
  captured.velocities.length = 0;
});

describe("staggerReaction", () => {
  it("builds a main-lane def at REACTION_PRIORITY by default", () => {
    const def = staggerReaction({
      direction: new Vec2(1, 0),
      knockback: 50,
      stun: 0.3,
    });
    expect(def.id).toBe("stagger");
    expect(def.lane).toBe("main");
    expect(def.priority).toBe(REACTION_PRIORITY);
  });

  it("accepts a custom priority for heavier/armored variants", () => {
    const def = staggerReaction({
      direction: new Vec2(1, 0),
      knockback: 50,
      stun: 0.3,
      priority: 500,
    });
    expect(def.priority).toBe(500);
  });
});

describe("staggerMotion (via force)", () => {
  it("begins the ramp on enter and ends it on exit", () => {
    const { entity, pc, stagger } = setup();
    const abilities = entity.add(new Abilities([]));

    abilities.force(
      staggerReaction({ direction: new Vec2(0, 1), knockback: 100, stun: 0.2 }),
    );
    pc._tick(0.01);
    expect(stagger.active).toBe(true);
    expect(captured.velocities).toEqual([{ x: 0, y: 100 }]);

    pc._tick(0.2); // reaches the window's `to` — exit fires
    expect(stagger.active).toBe(false);
    expect(captured.velocities).toEqual([
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ]);
  });

  it("throws when the entity has no Stagger component", () => {
    const { entity } = createMockEntity("no-stagger");
    const pc = entity.add(new ProcessComponent());
    const abilities = entity.add(new Abilities([]));

    abilities.force(
      staggerReaction({ direction: new Vec2(1, 0), knockback: 10, stun: 0.1 }),
    );
    expect(() => pc._tick(0.01)).toThrow(/requires a Stagger component/);
  });
});

describe("scenario: a recovery skill breaks out of an active stagger", () => {
  it("a higher-priority play() interrupts the forced stagger and zeroes velocity", () => {
    const { entity, pc, stagger } = setup();
    const abilities = entity.add(
      new Abilities([{ id: "burst", priority: 150, timeline: [] }]),
    );

    abilities.force(
      staggerReaction({ direction: new Vec2(1, 0), knockback: 100, stun: 1 }),
    );
    pc._tick(0.1);
    expect(abilities.activeId()).toBe("stagger");
    expect(stagger.active).toBe(true);

    expect(abilities.play("burst")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    expect(abilities.activeId()).toBe("burst");
    expect(stagger.active).toBe(false); // exit ran on interrupt
    expect(captured.velocities.at(-1)).toEqual({ x: 0, y: 0 });
  });
});

describe("scenario: a potion plays in its own lane during a main-lane stagger", () => {
  it("an `item`-lane ability plays concurrently, unaffected by the main-lane stagger", () => {
    const { entity, pc } = setup();
    const log: string[] = [];
    const drink = defineStep<{ tag: string }>("drink", {
      fire: (params) => log.push(`drink:${params.tag}`),
    });
    const abilities = entity.add(
      new Abilities([
        {
          id: "potion",
          lane: "item",
          duration: 0.2,
          timeline: [drink({ at: 0.05, tag: "heal" })],
        },
      ]),
    );

    abilities.force(
      staggerReaction({ direction: new Vec2(1, 0), knockback: 100, stun: 0.5 }),
    );
    pc._tick(0.1);
    expect(abilities.isActive("main")).toBe(true);

    expect(abilities.play("potion")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    expect(abilities.isActive("item")).toBe(true);

    pc._tick(0.05);
    expect(log).toEqual(["drink:heal"]);
    expect(abilities.isActive("item")).toBe(true); // duration 0.2 — still running
    expect(abilities.isActive("main")).toBe(true); // separate lane, untouched
  });
});
