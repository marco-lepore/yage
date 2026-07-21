import { describe, expect, it } from "vitest";
import {
  SerializableRegistry,
  createMockEntity,
  getSerializableType,
} from "@yagejs/core";
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

  it("registers a stable namespaced snapshot type", () => {
    const type = "@yagejs-addons/abilities/Health";

    expect(getSerializableType(Health)).toBe(type);
    expect(SerializableRegistry.get(type)).toBe(Health);
  });

  it("round-trips hp and max without emitting health events", () => {
    const original = new Health({ max: 20, initial: 7 });
    const snapshot = original.serialize();
    const { entity } = createMockEntity("restored-victim");
    const events: string[] = [];
    entity.on(HealthDamaged, () => events.push("damaged"));
    entity.on(HealthHealed, () => events.push("healed"));
    entity.on(HealthDied, () => events.push("died"));

    const restored = entity.add(Health.fromSnapshot(snapshot));

    expect(snapshot).toEqual({ hp: 7, max: 20 });
    expect(restored.hp).toBe(7);
    expect(restored.max).toBe(20);
    expect(events).toEqual([]);
  });

  it("restores dead health without emitting a death event", () => {
    const snapshot = new Health({ max: 20, initial: 0 }).serialize();
    const { entity } = createMockEntity("restored-dead-victim");
    const events: string[] = [];
    entity.on(HealthDamaged, () => events.push("damaged"));
    entity.on(HealthHealed, () => events.push("healed"));
    entity.on(HealthDied, () => events.push("died"));

    const restored = entity.add(Health.fromSnapshot(snapshot));

    expect(snapshot).toEqual({ hp: 0, max: 20 });
    expect(restored.isDead).toBe(true);
    expect(events).toEqual([]);
  });
});
