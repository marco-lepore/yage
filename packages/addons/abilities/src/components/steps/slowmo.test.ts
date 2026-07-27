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
    abilities.send("bt");
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

    abilities.send("bt");
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
          timeline: [
            slowmo({ from: 0, to: 1, scale: 0.5, includeOwner: true }),
          ],
        },
      ]),
    );

    abilities.send("bt");
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

    abilities.send("bt");
    pc._tick(0.01);
    expect(time.effectiveScale).toBe(0.3);
    abilities.cancel();
    expect(time.effectiveScale).toBe(1);
  });

  it("releases an open request with abilities or their host", () => {
    const { entity, pc, time } = setup();
    const abilities = entity.add(
      new Abilities([
        { id: "bt", timeline: [slowmo({ from: 0, to: 1, scale: 0.3 })] },
      ]),
    );

    abilities.send("bt");
    pc._tick(0.1);
    expect(time.effectiveScale).toBe(0.3);

    abilities.enabled = false;
    expect(time.effectiveScale).toBe(1);

    abilities.enabled = true;
    expect(time.effectiveScale).toBe(0.3);

    entity.setActive(false);
    expect(time.effectiveScale).toBe(1);

    entity.setActive(true);
    expect(time.effectiveScale).toBe(0.3);
  });

  it("keeps a timed request alive after phase completion and cancellation", () => {
    const completed = setup();
    const completedAbilities = completed.entity.add(
      new Abilities([
        { id: "bt", timeline: [slowmo({ at: 0, for: 0.5, scale: 0.25 })] },
      ]),
    );
    completedAbilities.send("bt");
    completed.pc._tick(0.01);
    expect(completedAbilities.isActive()).toBe(false);
    expect(completed.time.effectiveScale).toBe(0.25);
    completed.time._tick(0.5);
    expect(completed.time.effectiveScale).toBe(1);

    const cancelled = setup();
    const cancelledAbilities = cancelled.entity.add(
      new Abilities([
        {
          id: "bt",
          duration: 1,
          timeline: [slowmo({ at: 0, for: 0.5, scale: 0.4 })],
        },
      ]),
    );
    cancelledAbilities.send("bt");
    cancelled.pc._tick(0.01);
    cancelledAbilities.cancel();
    expect(cancelled.time.effectiveScale).toBe(0.4);
    cancelled.time._tick(0.5);
    expect(cancelled.time.effectiveScale).toBe(1);
  });

  it("passes key/label through to the request", () => {
    const { entity, pc, time } = setup();
    const abilities = entity.add(
      new Abilities([
        {
          id: "bt",
          timeline: [
            slowmo({
              from: 0,
              to: 1,
              scale: 0.5,
              key: "slowmo",
              label: "bullet-time",
            }),
          ],
        },
      ]),
    );

    abilities.send("bt");
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

    abilities.send("stop");
    expect(() => pc._tick(0.01)).toThrow(/factor must be finite and > 0/);
  });
});
