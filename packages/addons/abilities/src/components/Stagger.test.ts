import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vec2, createMockEntity } from "@yagejs/core";
import { RigidBodyComponent } from "@yagejs/physics";
import { Stagger } from "./Stagger.js";

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
  const stagger = entity.add(new Stagger());
  return { entity, stagger };
}

beforeEach(() => {
  captured.velocities.length = 0;
});

describe("Stagger", () => {
  it("begin sets the peak knockback velocity along the unit direction", () => {
    const { stagger } = setup();
    stagger.begin({ direction: new Vec2(0, 10), knockback: 100, stun: 0.5 });
    expect(stagger.active).toBe(true);
    expect(captured.velocities).toEqual([{ x: 0, y: 100 }]);
  });

  it("ramps velocity linearly to zero across the stun window", () => {
    const { stagger } = setup();
    stagger.begin({ direction: new Vec2(1, 0), knockback: 100, stun: 0.5 });
    stagger.update(0.25);
    stagger.update(0.25);
    stagger.update(0.25); // past the window — no further writes
    expect(captured.velocities).toEqual([
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(stagger.active).toBe(false);
  });

  it("a repeat begin replaces vector and timer (last hit wins)", () => {
    const { stagger } = setup();
    stagger.begin({ direction: new Vec2(1, 0), knockback: 100, stun: 0.4 });
    stagger.update(0.2);
    stagger.begin({ direction: new Vec2(0, 1), knockback: 60, stun: 0.4 });
    stagger.update(0.2);
    expect(captured.velocities).toEqual([
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 60 },
      { x: 0, y: 30 },
    ]);
  });

  it("a zero-length direction falls back to +x", () => {
    const { stagger } = setup();
    stagger.begin({ direction: Vec2.ZERO, knockback: 80, stun: 0.2 });
    expect(captured.velocities).toEqual([{ x: 80, y: 0 }]);
  });

  it("a stun of 0 does nothing", () => {
    const { stagger } = setup();
    stagger.begin({ direction: new Vec2(1, 0), knockback: 100, stun: 0 });
    expect(stagger.active).toBe(false);
    expect(captured.velocities).toEqual([]);
  });

  it("end zeroes velocity and clears active early", () => {
    const { stagger } = setup();
    stagger.begin({ direction: new Vec2(1, 0), knockback: 100, stun: 0.5 });
    stagger.update(0.1);
    stagger.end();
    expect(stagger.active).toBe(false);
    expect(captured.velocities).toEqual([
      { x: 100, y: 0 },
      { x: 80, y: 0 },
      { x: 0, y: 0 },
    ]);
    stagger.update(0.1); // ended — no further writes
    expect(captured.velocities).toHaveLength(3);
  });

  it("zeroes active knockback while disabled and restores the same ramp on enable", () => {
    const { stagger } = setup();
    stagger.begin({ direction: new Vec2(1, 0), knockback: 100, stun: 0.5 });
    stagger.update(0.1);

    stagger.enabled = false;
    expect(captured.velocities.at(-1)).toEqual({ x: 0, y: 0 });

    stagger.enabled = true;
    expect(captured.velocities.at(-1)).toEqual({ x: 80, y: 0 });
    expect(stagger.active).toBe(true);
  });

  it("uses the same knockback lifecycle while the host entity is inactive", () => {
    const { entity, stagger } = setup();
    stagger.begin({ direction: new Vec2(0, 1), knockback: 60, stun: 0.5 });

    entity.setActive(false);
    expect(captured.velocities.at(-1)).toEqual({ x: 0, y: 0 });

    entity.setActive(true);
    expect(captured.velocities.at(-1)).toEqual({ x: 0, y: 60 });
  });

  it("can start a fresh stagger after a suspended one ends", () => {
    const { stagger } = setup();
    stagger.begin({ direction: new Vec2(1, 0), knockback: 100, stun: 0.5 });
    stagger.suspend();
    stagger.end();
    stagger.begin({ direction: new Vec2(0, 1), knockback: 60, stun: 0.5 });

    expect(captured.velocities.at(-1)).toEqual({ x: 0, y: 60 });
  });
});
