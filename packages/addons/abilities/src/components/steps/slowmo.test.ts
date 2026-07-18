import { describe, expect, it } from "vitest";
import { ProcessComponent, SceneTimeKey, createMockEntity } from "@yagejs/core";
import { Abilities } from "../../core/Abilities.js";
import { slowmo } from "./slowmo.js";

function setup() {
  const { entity, scene } = createMockEntity("caster");
  const pc = entity.add(new ProcessComponent());
  const time = scene.tryResolveScoped(SceneTimeKey)!;
  return { entity, pc, time };
}

describe("slowmo step", () => {
  it("dilates the world while the window is open and restores on close", () => {
    const { entity, pc, time } = setup();
    const abilities = entity.add(
      new Abilities([
        { id: "bt", timeline: [slowmo({ from: 0.1, to: 0.3, scale: 0.25 })] },
      ]),
    );

    expect(time.effectiveScale).toBe(1);
    abilities.play("bt");
    pc._tick(0.1); // enter
    expect(time.effectiveScale).toBe(0.25);
    pc._tick(0.25); // past to=0.3 → exit
    expect(time.effectiveScale).toBe(1);
  });

  it("excludes the owner by default — the world slows but the owner runs at scene speed", () => {
    const { entity, pc, time } = setup();
    const abilities = entity.add(
      new Abilities([
        { id: "bt", timeline: [slowmo({ from: 0, to: 1, scale: 0.25 })] },
      ]),
    );

    abilities.play("bt");
    pc._tick(0.01); // enter
    expect(time.effectiveScale).toBe(0.25); // world (and physics) slowed
    expect(time.effectiveScaleForUpdates(entity)).toBe(1); // owner unaffected
  });

  it("includeOwner slows the owner too", () => {
    const { entity, pc, time } = setup();
    const abilities = entity.add(
      new Abilities([
        {
          id: "bt",
          timeline: [slowmo({ from: 0, to: 1, scale: 0.5, includeOwner: true })],
        },
      ]),
    );

    abilities.play("bt");
    pc._tick(0.01);
    expect(time.effectiveScaleForUpdates(entity)).toBe(0.5);
  });

  it("cancel releases the request early", () => {
    const { entity, pc, time } = setup();
    const abilities = entity.add(
      new Abilities([
        { id: "bt", timeline: [slowmo({ from: 0, to: 1, scale: 0.3 })] },
      ]),
    );

    abilities.play("bt");
    pc._tick(0.01);
    expect(time.effectiveScale).toBe(0.3);
    abilities.cancel();
    expect(time.effectiveScale).toBe(1);
  });

  it("passes key/label through to the request", () => {
    const { entity, pc, time } = setup();
    const abilities = entity.add(
      new Abilities([
        {
          id: "bt",
          timeline: [
            slowmo({ from: 0, to: 1, scale: 0.5, key: "slowmo", label: "bullet-time" }),
          ],
        },
      ]),
    );

    abilities.play("bt");
    pc._tick(0.01);
    expect(time.activeLabels).toEqual(["bullet-time"]);
  });

  it("throws for a non-positive scale (freeze goes through freezeFor)", () => {
    const { entity, pc } = setup();
    const abilities = entity.add(
      new Abilities([
        { id: "stop", timeline: [slowmo({ from: 0, to: 1, scale: 0 })] },
      ]),
    );

    abilities.play("stop");
    expect(() => pc._tick(0.01)).toThrow(/factor must be finite and > 0/);
  });
});
