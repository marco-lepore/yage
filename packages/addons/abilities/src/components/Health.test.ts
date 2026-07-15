import { describe, expect, it } from "vitest";
import { createMockEntity } from "@yagejs/core";
import { Health, HealthDamaged, HealthDied, HealthHealed } from "./Health.js";

function setup(options: { max: number; initial?: number }) {
  const { entity } = createMockEntity("victim");
  const health = entity.add(new Health(options));
  const events: string[] = [];
  entity.on(HealthDamaged, (e) => events.push(`damaged:${e.amount}:${e.hp}`));
  entity.on(HealthHealed, (e) => events.push(`healed:${e.amount}:${e.hp}`));
  entity.on(HealthDied, () => events.push("died"));
  return { health, events };
}

describe("Health", () => {
  it("starts at max unless an initial value is given", () => {
    expect(setup({ max: 10 }).health.hp).toBe(10);
    expect(setup({ max: 10, initial: 4 }).health.hp).toBe(4);
  });

  it("takeDamage subtracts and returns the applied (clamped) amount", () => {
    const { health, events } = setup({ max: 10 });
    expect(health.takeDamage(3)).toBe(3);
    expect(health.hp).toBe(7);
    expect(health.takeDamage(100)).toBe(7); // clamped to remaining hp
    expect(health.hp).toBe(0);
    expect(events).toEqual(["damaged:3:7", "damaged:7:0", "died"]);
  });

  it("dies once; further damage is ignored and returns 0", () => {
    const { health, events } = setup({ max: 5 });
    health.takeDamage(5);
    expect(health.takeDamage(5)).toBe(0);
    expect(events).toEqual(["damaged:5:0", "died"]);
    expect(health.isDead).toBe(true);
  });

  it("ignores non-positive damage, returning 0", () => {
    const { health, events } = setup({ max: 10 });
    expect(health.takeDamage(0)).toBe(0);
    expect(health.takeDamage(-2)).toBe(0);
    expect(health.hp).toBe(10);
    expect(events).toEqual([]);
  });

  it("heal restores and clamps at max, returning the applied amount", () => {
    const { health, events } = setup({ max: 10, initial: 5 });
    expect(health.heal(3)).toBe(3);
    expect(health.hp).toBe(8);
    expect(health.heal(100)).toBe(2); // clamped to headroom
    expect(health.hp).toBe(10);
    expect(health.heal(1)).toBe(0); // already full — no event
    expect(events).toEqual(["healed:3:8", "healed:2:10"]);
  });

  it("heal can't revive the dead, returning 0", () => {
    const { health, events } = setup({ max: 10 });
    health.takeDamage(10);
    expect(health.heal(5)).toBe(0);
    expect(health.hp).toBe(0);
    expect(events).toEqual(["damaged:10:0", "died"]);
  });
});
