import { describe, expect, it } from "vitest";
import {
  createMockEntity,
  KeyframeAnimator,
  ProcessComponent,
} from "@yagejs/core";
import {
  Abilities,
  AbilityEnded,
  AbilityStarted,
  PhaseChanged,
} from "./Abilities.js";
import { defineStep } from "./defineStep.js";
import { anim } from "../components/steps/anim.js";
import type { AbilityActivation, AbilityDef } from "./types.js";

const beep = defineStep<{ id: string }>("beep", {
  fire: (params, ctx) => {
    log(ctx).push(`fire:${params.id}`);
  },
});

const zone = defineStep<{ id: string }>("zone", {
  enter: (params, ctx) => log(ctx).push(`enter:${params.id}`),
  exit: (params, ctx, cancelled) =>
    log(ctx).push(`exit:${params.id}:${cancelled}`),
  tick: (params, ctx) => log(ctx).push(`tick:${params.id}`),
});

// Steps read the shared log off the ability's def id via a WeakMap keyed by
// the Abilities instance — keeps step definitions reusable across tests
// without threading a fresh log through every def.
const logs = new WeakMap<object, string[]>();
function log(ctx: { abilities: object }): string[] {
  let entries = logs.get(ctx.abilities);
  if (!entries) {
    entries = [];
    logs.set(ctx.abilities, entries);
  }
  return entries;
}

function setup(defs: readonly AbilityDef[]) {
  const { entity, scene } = createMockEntity("abilities-host");
  const pc = entity.add(new ProcessComponent());
  const abilities = entity.add(new Abilities(defs));
  return { entity, scene, pc, abilities, log: log({ abilities }) };
}

const okResult = { ok: true, activation: expect.any(Object) };

describe("Abilities — timeline playback (single-phase sugar)", () => {
  it("points fire at their time, not before", () => {
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [beep({ at: 0.2, id: "a" }), beep({ at: 0.4, id: "b" })],
      },
    ]);
    abilities.send("test");
    pc._tick(0.1);
    expect(log).toEqual([]);
    pc._tick(0.1); // elapsed 0.2
    expect(log).toEqual(["fire:a"]);
    pc._tick(0.19);
    expect(log).toEqual(["fire:a"]);
    pc._tick(0.01); // elapsed 0.4
    expect(log).toEqual(["fire:a", "fire:b"]);
  });

  it("a window's enter and exit both fire", () => {
    const { pc, abilities, log } = setup([
      { id: "test", timeline: [zone({ from: 0.1, to: 0.3, id: "z" })] },
    ]);
    abilities.send("test");
    pc._tick(0.1);
    expect(log).toEqual(["enter:z"]);
    pc._tick(0.2);
    expect(log).toEqual(["enter:z", "exit:z:false"]);
  });

  it("half-open semantics: an exit at t fires before a point step at the same t", () => {
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [
          zone({ from: 0, to: 0.3, id: "z" }),
          beep({ at: 0.3, id: "b" }),
          beep({ at: 0.5, id: "end" }), // extends duration past the tie
        ],
      },
    ]);
    abilities.send("test");
    pc._tick(0.29);
    expect(log).toEqual(["enter:z"]);
    pc._tick(0.01); // hits 0.3 exactly
    expect(log).toEqual(["enter:z", "exit:z:false", "fire:b"]);
    pc._tick(0.2);
    expect(log).toEqual(["enter:z", "exit:z:false", "fire:b", "fire:end"]);
  });

  it("`every` produces the exact expected tick count", () => {
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [zone({ from: 0.1, to: 0.5, every: 0.1, id: "z" })],
      },
    ]);
    abilities.send("test");
    pc._tick(0.5);
    // enter@0.1, tick@0.2/0.3/0.4, exit@0.5 — 0.5 itself is excluded (half-open).
    expect(log).toEqual([
      "enter:z",
      "tick:z",
      "tick:z",
      "tick:z",
      "exit:z:false",
    ]);
  });

  it("cancel mid-window closes it with cancelled=true; later points never fire", () => {
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [
          zone({ from: 0, to: 0.5, id: "z" }),
          beep({ at: 0.6, id: "late" }),
        ],
      },
    ]);
    abilities.send("test");
    pc._tick(0.2);
    abilities.cancel();
    pc._tick(1);
    expect(log).toEqual(["enter:z", "exit:z:true"]);
    expect(abilities.isActive()).toBe(false);
  });

  it("overlapping windows are both open; cancel closes both in timeline order", () => {
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [
          zone({ from: 0, to: 1, id: "outer" }),
          zone({ from: 0.1, to: 0.9, id: "inner" }),
        ],
      },
    ]);
    abilities.send("test");
    pc._tick(0.2);
    expect(log).toEqual(["enter:outer", "enter:inner"]);
    abilities.cancel();
    expect(log).toEqual([
      "enter:outer",
      "enter:inner",
      "exit:outer:true",
      "exit:inner:true",
    ]);
  });

  it("a timeline mixes steps with different params shapes", () => {
    const { entity, pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [
          anim({ at: 0, name: "swing" }), // params: { name: string }
          zone({ from: 0, to: 0.2, id: "z" }), // params: { id: string }
        ],
      },
    ]);
    const animator = entity.add(
      new KeyframeAnimator({
        swing: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 1, data: 1 },
          ],
          setter: () => {},
        },
      }),
    );

    abilities.send("test");
    pc._tick(0.01);
    expect(animator.isPlaying("swing")).toBe(true);
    expect(log).toEqual(["enter:z"]);
  });

  it("cancel() is a no-op when idle", () => {
    const { abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    expect(() => abilities.cancel()).not.toThrow();
    expect(abilities.isActive()).toBe(false);
  });

  it("destroying the entity mid-ability closes open windows with cancelled=true", () => {
    const { entity, scene, pc, abilities, log } = setup([
      { id: "test", timeline: [zone({ from: 0, to: 1, id: "z" })] },
    ]);
    abilities.send("test");
    pc._tick(0.2);
    expect(log).toEqual(["enter:z"]);
    entity.destroy();
    scene._flushDestroyQueue();
    expect(log).toEqual(["enter:z", "exit:z:true"]);
  });
});

describe("Abilities — activation gating", () => {
  it("send(id) is refused as busy while active, succeeds again once idle", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.2, id: "a" })] },
    ]);
    expect(abilities.send("test")).toEqual(okResult);
    expect(abilities.send("test")).toEqual({ ok: false, reason: "busy" });
    pc._tick(0.2);
    expect(abilities.isActive()).toBe(false);
  });

  it("send(id) is refused as cooldown during cooldown, succeeds again once it elapses", () => {
    const { pc, abilities } = setup([
      { id: "test", cooldown: 0.3, timeline: [beep({ at: 0.2, id: "a" })] },
    ]);
    expect(abilities.send("test")).toEqual(okResult);
    pc._tick(0.2); // ability completes; cooldown (started at send time) at 0.2/0.3
    expect(abilities.isActive()).toBe(false);
    expect(abilities.send("test")).toEqual({ ok: false, reason: "cooldown" });
    pc._tick(0.1); // cooldown reaches 0.3
    expect(abilities.send("test")).toEqual(okResult);
  });

  it("throws for an intent no registered def answers to", () => {
    const { abilities } = setup([
      { id: "known", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    expect(() => abilities.send("nope")).toThrow(/unknown intent "nope"/);
    expect(() => abilities.canSend("nope")).toThrow(/unknown intent "nope"/);
    expect(() => abilities.cooldownRemaining("nope")).toThrow(
      /unknown ability id "nope"/,
    );
  });

  it("elapsed is null when idle and advances while active", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.2, id: "a" })] },
    ]);
    expect(abilities.elapsed()).toBeNull();
    abilities.send("test");
    pc._tick(0.1);
    expect(abilities.elapsed()).toBeCloseTo(0.1);
    pc._tick(0.1);
    expect(abilities.elapsed()).toBeNull();
  });

  it("cooldownRemaining counts down to 0; cooldownRatio counts up to 1", () => {
    const { pc, abilities } = setup([
      { id: "test", cooldown: 0.4, timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    expect(abilities.cooldownRemaining("test")).toBe(0);
    expect(abilities.cooldownRatio("test")).toBe(1);
    abilities.send("test");
    pc._tick(0.25);
    expect(abilities.cooldownRemaining("test")).toBeCloseTo(0.15);
    expect(abilities.cooldownRatio("test")).toBeCloseTo(0.625);
    pc._tick(0.15);
    expect(abilities.cooldownRemaining("test")).toBe(0);
    expect(abilities.cooldownRatio("test")).toBe(1);
  });

  it("resolves a Scalar cooldown once per activation, re-arming with the fresh value", () => {
    let haste = 0; // 0 -> 0.4s cooldown, 1 -> 0.2s cooldown
    const { pc, abilities } = setup([
      {
        id: "test",
        cooldown: () => 0.4 - haste * 0.2,
        timeline: [beep({ at: 0.1, id: "a" })],
      },
    ]);

    abilities.send("test");
    expect(abilities.cooldownRemaining("test")).toBeCloseTo(0.4);
    pc._tick(0.4); // ability completes at 0.1, cooldown (0.4) elapses now
    expect(abilities.cooldownRemaining("test")).toBe(0);

    // A haste pickup shortens the next cooldown; the snapshot is taken at send.
    haste = 1;
    expect(abilities.send("test")).toEqual(okResult);
    expect(abilities.cooldownRemaining("test")).toBeCloseTo(0.2);
    pc._tick(0.2);
    expect(abilities.cooldownRemaining("test")).toBe(0);
    expect(abilities.send("test")).toEqual(okResult);
  });

  it("passes the activation's StepContext to a Scalar cooldown resolver", () => {
    let seen: AbilityActivation | undefined;
    const { abilities } = setup([
      {
        id: "test",
        cooldown: (ctx) => {
          seen = ctx.activation;
          return 0.3;
        },
        timeline: [beep({ at: 0.1, id: "a" })],
      },
    ]);
    const result = abilities.send("test");
    expect(result.ok).toBe(true);
    expect(seen).toBe(result.ok ? result.activation : undefined);
  });
});

describe("Abilities — construction validation", () => {
  it("throws on duplicate ability ids", () => {
    const def: AbilityDef = { id: "a", timeline: [] };
    expect(() => new Abilities([def, { ...def }])).toThrow(
      /duplicate ability id "a"/,
    );
  });

  it("throws when a def declares both timeline and phases, or neither", () => {
    expect(
      () =>
        new Abilities([
          {
            id: "both",
            timeline: [],
            phases: { main: { timeline: [] } },
          } as unknown as AbilityDef,
        ]),
    ).toThrow(/exactly one of `timeline` or `phases`/);
    expect(
      () => new Abilities([{ id: "neither" } as unknown as AbilityDef]),
    ).toThrow(/exactly one of `timeline` or `phases`/);
  });

  it("throws on an empty phases map and on a start that is not a phase key", () => {
    expect(
      () => new Abilities([{ id: "empty", phases: {} }]),
    ).toThrow(/has no phases/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: { windup: { timeline: [] } },
            start: "ghost",
          },
        ]),
    ).toThrow(/start phase "ghost" is not a phase key/);
    // Inherited Object.prototype names must not pass as phase keys.
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: { windup: { timeline: [] } },
            start: "toString",
          },
        ]),
    ).toThrow(/start phase "toString" is not a phase key/);
  });

  it("throws when on:/next/after/entry target an unknown phase", () => {
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: {
              main: { timeline: [], duration: 0.2, on: { go: "ghost" } },
            },
          },
        ]),
    ).toThrow(/on:"go" targets unknown phase "ghost"/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: { main: { timeline: [], duration: 0.2, next: "ghost" } },
          },
        ]),
    ).toThrow(/next targets unknown phase "ghost"/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: {
              main: {
                timeline: [],
                duration: 0.2,
                after: { at: 0.1, to: "ghost" },
              },
            },
          },
        ]),
    ).toThrow(/after targets unknown phase "ghost"/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            entry: { door: "ghost" },
            timeline: [beep({ at: 0.1, id: "a" })],
          },
        ]),
    ).toThrow(/entry "door" targets unknown phase "ghost"/);
  });

  it("throws on cross-def entry-intent collisions, including a def id used as another's alias", () => {
    expect(
      () =>
        new Abilities([
          { id: "dash", timeline: [beep({ at: 0.1, id: "d" })] },
          {
            id: "roll",
            entry: { dash: "main" },
            timeline: [beep({ at: 0.1, id: "r" })],
          },
        ]),
    ).toThrow(/entry intent "dash" collides between abilities "dash" and "roll"/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            entry: { evade: "main" },
            timeline: [beep({ at: 0.1, id: "a" })],
          },
          {
            id: "b",
            entry: { evade: "main" },
            timeline: [beep({ at: 0.1, id: "b" })],
          },
        ]),
    ).toThrow(/entry intent "evade" collides between abilities "a" and "b"/);
  });

  it("throws on a zero-time next/after cycle", () => {
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: {
              x: { timeline: [], next: "y" },
              y: { timeline: [], next: "x" },
            },
          },
        ]),
    ).toThrow(/zero-time next\/after cycle/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: {
              x: { timeline: [], duration: 0.5, after: { at: 0, to: "y" } },
              y: { timeline: [], duration: 0.5, after: { at: 0, to: "x" } },
            },
          },
        ]),
    ).toThrow(/zero-time next\/after cycle/);
  });

  it("throws on malformed guards, hold caps, and after times", () => {
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: {
              main: {
                timeline: [],
                duration: 0.5,
                on: { go: { to: "main", from: 0.4, until: 0.4 } },
              },
            },
          },
        ]),
    ).toThrow(/on:"go" has until=0\.4 <= from=0\.4/);
    expect(
      () =>
        new Abilities([
          { id: "a", phases: { main: { timeline: [], hold: { max: 0 } } } },
        ]),
    ).toThrow(/hold\.max=0 <= 0/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: { main: { timeline: [], hold: true, duration: 1 } },
          },
        ]),
    ).toThrow(/is a hold with an explicit duration/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            phases: {
              main: {
                timeline: [],
                duration: 0.3,
                after: { at: 0.3, to: "main" },
              },
            },
          },
        ]),
    ).toThrow(/after\.at=0\.3 at or past the phase's end 0\.3/);
  });

  it('throws on an "end" window with no room before a fixed phase\'s boundary, and on the deleted "release" sentinel', () => {
    expect(
      () =>
        new Abilities([
          { id: "a", timeline: [zone({ from: 0, to: "end", id: "z" })] },
        ]),
    ).toThrow(/opens at 0, at or past the phase's end 0/);
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            timeline: [
              zone({ from: 0, to: "release" as never, id: "z" }),
            ],
          },
        ]),
    ).toThrow(/has to=release — expected a number or "end"/);
  });

  it("throws when the same step object appears twice in one def, even across phases", () => {
    const shared = beep({ at: 0.1, id: "a" });
    expect(
      () => new Abilities([{ id: "a", timeline: [shared, shared] }]),
    ).toThrow(/step "beep" \(step #1\) is the same step object/);
    const sharedZone = zone({ from: 0, to: 0.2, id: "z" });
    expect(
      () =>
        new Abilities([
          {
            id: "b",
            phases: {
              one: { timeline: [sharedZone] },
              two: { timeline: [sharedZone] },
            },
          },
        ]),
    ).toThrow(/is the same step object/);
  });

  it("keeps the step-shape checks: negative times, every<=0, to<=from, steps past an explicit duration", () => {
    expect(
      () =>
        new Abilities([
          { id: "a", timeline: [zone({ from: 0.5, to: 0.5, id: "z" })] },
        ]),
    ).toThrow(/to=0\.5 <= from=0\.5/);
    expect(
      () =>
        new Abilities([{ id: "a", timeline: [beep({ at: -0.1, id: "a" })] }]),
    ).toThrow(/at=-0\.1 < 0/);
    expect(
      () =>
        new Abilities([
          { id: "a", timeline: [zone({ from: -0.1, to: 0.2, id: "z" })] },
        ]),
    ).toThrow(/from=-0\.1 < 0/);
    expect(
      () =>
        new Abilities([
          { id: "a", timeline: [zone({ from: 0, to: 1, every: 0, id: "z" })] },
        ]),
    ).toThrow(/every=0 <= 0/);
    expect(
      () =>
        new Abilities([
          { id: "a", duration: 0.5, timeline: [beep({ at: 0.6, id: "a" })] },
        ]),
    ).toThrow(/ending at 0\.6, past its explicit duration 0\.5/);
  });

  it("defaults duration to the max step end time when omitted", () => {
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [
          beep({ at: 0.2, id: "a" }),
          zone({ from: 0, to: 0.5, id: "z" }),
        ],
      },
    ]);
    abilities.send("test");
    pc._tick(0.5);
    expect(abilities.isActive()).toBe(false); // completed exactly at the last step end
    expect(log).toEqual(["enter:z", "fire:a", "exit:z:false"]);
  });
});

describe("Abilities — activation rule (lanes + priority)", () => {
  it("a send() at equal priority to the active def is refused", () => {
    const { abilities } = setup([
      { id: "a", timeline: [beep({ at: 0.5, id: "a" })] },
      { id: "b", timeline: [beep({ at: 0.5, id: "b" })] },
    ]);
    expect(abilities.send("a")).toEqual(okResult);
    expect(abilities.send("b")).toEqual({ ok: false, reason: "busy" });
    expect(abilities.activeId()).toBe("a");
  });

  it("a higher-priority send() interrupts the active def, closing its windows as cancelled", () => {
    const { pc, abilities, log } = setup([
      { id: "a", timeline: [zone({ from: 0, to: 1, id: "z" })] },
      { id: "b", priority: 10, timeline: [beep({ at: 0, id: "b" })] },
    ]);
    abilities.send("a");
    pc._tick(0.1);
    expect(log).toEqual(["enter:z"]);
    expect(abilities.send("b")).toEqual(okResult);
    expect(log).toEqual(["enter:z", "exit:z:true"]);
    expect(abilities.activeId()).toBe("b");
  });

  it("force() with the same def object restarts it, closing the old windows as cancelled", () => {
    const { pc, abilities, log } = setup([]);
    const reactionDef: AbilityDef = {
      id: "r",
      priority: 5,
      timeline: [zone({ from: 0, to: 1, id: "z" })],
    };
    abilities.force(reactionDef);
    pc._tick(0.1);
    expect(log).toEqual(["enter:z"]);
    expect(abilities.force(reactionDef)).toEqual(okResult);
    expect(log).toEqual(["enter:z", "exit:z:true"]); // restart hasn't ticked yet
    pc._tick(0.01);
    expect(log).toEqual(["enter:z", "exit:z:true", "enter:z"]);
  });

  it("a lower-priority force() is refused as busy (super-armor)", () => {
    const { abilities } = setup([
      { id: "a", priority: 100, timeline: [beep({ at: 0.5, id: "a" })] },
    ]);
    abilities.send("a");
    const weak: AbilityDef = {
      id: "weak",
      priority: 10,
      timeline: [beep({ at: 0, id: "w" })],
    };
    expect(abilities.force(weak)).toEqual({ ok: false, reason: "busy" });
    expect(abilities.activeId()).toBe("a");
  });

  it("a higher-priority force() interrupts a lower-priority active def", () => {
    const { abilities } = setup([
      { id: "a", priority: 10, timeline: [beep({ at: 0.5, id: "a" })] },
    ]);
    abilities.send("a");
    const strong: AbilityDef = {
      id: "strong",
      priority: 100,
      timeline: [beep({ at: 0, id: "s" })],
    };
    expect(abilities.force(strong)).toEqual(okResult);
    expect(abilities.activeId()).toBe("strong");
  });

  it("force bypasses cooldown; send remains gated by it", () => {
    const aDef: AbilityDef = {
      id: "a",
      cooldown: 0.5,
      timeline: [beep({ at: 0.1, id: "a" })],
    };
    const { pc, abilities } = setup([aDef]);
    abilities.send("a");
    pc._tick(0.1); // completes; cooldown now running
    expect(abilities.send("a")).toEqual({ ok: false, reason: "cooldown" });
    expect(abilities.force(aDef)).toEqual(okResult); // same def, but force ignores cooldown
  });
});

describe("Abilities — per-phase priority", () => {
  const charge = (): AbilityDef => ({
    id: "charge",
    phases: {
      charge: {
        hold: true,
        next: "kick",
        timeline: [zone({ from: 0, to: "end", id: "windup" })],
      },
      kick: {
        priority: 110,
        duration: 0.6,
        timeline: [zone({ from: 0.1, to: 0.25, id: "hit" })],
      },
    },
  });
  const stagger = (): AbilityDef => ({
    id: "stagger",
    priority: 100,
    timeline: [zone({ from: 0, to: 0.3, id: "st" })],
  });

  it("a forced reaction interrupts the low-priority charge phase but not the kick phase of the same def", () => {
    const { pc, abilities } = setup([charge()]);
    abilities.send("charge");
    pc._tick(0.2); // charging (phase priority = def default 0)
    expect(abilities.force(stagger())).toEqual(okResult);
    expect(abilities.activeId()).toBe("stagger");

    pc._tick(0.5); // stagger completes
    abilities.send("charge");
    pc._tick(0.2);
    abilities.release("charge"); // → kick, phase priority 110
    expect(abilities.active()?.phase).toBe("kick");
    expect(abilities.force(stagger())).toEqual({ ok: false, reason: "busy" });
    expect(abilities.activeId()).toBe("charge");
  });

  it("the effective priority is the current phase's, read fresh after each transition", () => {
    const { pc, abilities } = setup([charge()]);
    abilities.send("charge");
    pc._tick(0.1);
    abilities.release("charge");
    pc._tick(0.7); // kick completes → idle
    expect(abilities.isActive()).toBe(false);
    expect(abilities.force(stagger())).toEqual(okResult); // idle lane admits anything
  });
});

describe("Abilities — lanes", () => {
  it("two lanes run concurrently, independent of each other", () => {
    const { pc, abilities, log } = setup([
      {
        id: "a",
        lane: "main",
        timeline: [zone({ from: 0, to: 0.3, id: "a" })],
      },
      {
        id: "b",
        lane: "side",
        timeline: [zone({ from: 0, to: 0.3, id: "b" })],
      },
    ]);
    expect(abilities.send("a")).toEqual(okResult);
    expect(abilities.send("b")).toEqual(okResult);
    pc._tick(0.1);
    expect(log).toEqual(expect.arrayContaining(["enter:a", "enter:b"]));
    expect(abilities.isActive("main")).toBe(true);
    expect(abilities.isActive("side")).toBe(true);
  });

  it("cancel/isActive/activeId/elapsed operate per-lane", () => {
    const { pc, abilities } = setup([
      { id: "a", lane: "main", timeline: [beep({ at: 1, id: "a" })] },
      { id: "b", lane: "side", timeline: [beep({ at: 1, id: "b" })] },
    ]);
    abilities.send("a");
    abilities.send("b");
    pc._tick(0.2);
    expect(abilities.activeId("main")).toBe("a");
    expect(abilities.activeId("side")).toBe("b");
    expect(abilities.elapsed("main")).toBeCloseTo(0.2);

    abilities.cancel("main");
    expect(abilities.isActive("main")).toBe(false);
    expect(abilities.isActive("side")).toBe(true); // untouched
    expect(abilities.activeId("side")).toBe("b");
  });

  it("canSend excludes the priority-interrupt door by default; { interrupts: true } is the full send dry-run", () => {
    const { pc, abilities } = setup([
      { id: "jab", timeline: [zone({ from: 0, to: 1, id: "j" })] },
      { id: "burst", priority: 200, timeline: [beep({ at: 0.1, id: "b" })] },
    ]);
    abilities.send("jab");
    pc._tick(0.1);
    // Polite default: a retried/buffered press must not preempt the jab...
    expect(abilities.canSend("burst")).toBe(false);
    // ...but the full dry-run answers what a direct send would do:
    expect(abilities.canSend("burst", undefined, { interrupts: true })).toBe(
      true,
    );
    expect(abilities.send("burst")).toEqual(okResult);
    expect(abilities.activeId()).toBe("burst");
  });

  it("{ interrupts: true } reads the occupant's CURRENT phase priority and still respects cooldown", () => {
    const { pc, abilities } = setup([
      {
        id: "charge",
        phases: {
          charge: { hold: true, next: "kick", timeline: [] },
          kick: { priority: 110, timeline: [], duration: 0.5 },
        },
      },
      { id: "stomp", priority: 100, cooldown: 5, timeline: [beep({ at: 0.1, id: "s" })] },
    ]);
    abilities.send("charge");
    pc._tick(0.1);
    // Windup phase (priority 0): 100 would win the lane.
    expect(abilities.canSend("stomp", undefined, { interrupts: true })).toBe(true);
    abilities.release("charge"); // → kick, phase priority 110
    expect(abilities.canSend("stomp", undefined, { interrupts: true })).toBe(false);
    pc._tick(0.6); // kick completes → idle
    abilities.send("stomp"); // arms the 5s cooldown
    pc._tick(0.2); // stomp completes; cooldown still running
    expect(abilities.canSend("stomp", undefined, { interrupts: true })).toBe(false);
  });

  it("an explicit lane argument scopes send/canSend to that lane", () => {
    const { abilities } = setup([
      { id: "a", lane: "main", timeline: [beep({ at: 1, id: "a" })] },
      { id: "b", lane: "side", timeline: [beep({ at: 1, id: "b" })] },
    ]);
    // The entry door's own lane must match the queried one.
    expect(abilities.canSend("b", "main")).toBe(false);
    expect(abilities.send("b", undefined, "main")).toEqual({
      ok: false,
      reason: "noMatch",
    });
    expect(abilities.canSend("b", "side")).toBe(true);
    expect(abilities.send("b", undefined, "side")).toEqual(okResult);
  });
});

describe("Abilities — combo (guarded on: transitions)", () => {
  const combo = (): AbilityDef => ({
    id: "attack",
    cooldown: 0.3,
    phases: {
      jab: {
        timeline: [zone({ from: 0, to: 0.2, id: "jab" })],
        duration: 0.45,
        on: { attack: { to: "cross", from: 0.25, until: 0.6 } },
      },
      cross: {
        timeline: [zone({ from: 0, to: 0.2, id: "cross" })],
        duration: 0.5,
        on: { attack: { to: "hook", from: 0.25, until: 0.6 } },
      },
      hook: { timeline: [zone({ from: 0, to: 0.3, id: "hook" })], duration: 1.1 },
    },
  });

  it("a guarded press advances the phase in place — same activation, no new Started, PhaseChanged fires", () => {
    const { entity, pc, abilities } = setup([combo()]);
    const started: string[] = [];
    const phases: string[] = [];
    entity.on(AbilityStarted, ({ activation }) =>
      started.push(activation.def.id),
    );
    entity.on(PhaseChanged, ({ from, to }) => phases.push(`${from}->${to}`));

    const result = abilities.send("attack");
    if (!result.ok) throw new Error("expected send to succeed");
    pc._tick(0.3); // inside [0.25, 0.6]
    expect(abilities.canSend("attack")).toBe(true);
    expect(abilities.send("attack")).toEqual({
      ok: true,
      activation: result.activation, // the SAME handle
    });
    expect(abilities.active()).toBe(result.activation);
    expect(abilities.active()?.phase).toBe("cross");
    expect(started).toEqual(["attack"]); // one run
    expect(phases).toEqual(["jab->cross"]);
  });

  it('a declared intent with a failing guard refuses "noMatch", does not fall through, and canSend is false', () => {
    const { pc, abilities } = setup([combo()]);
    abilities.send("attack");
    pc._tick(0.1); // before the window opens at 0.25
    expect(abilities.canSend("attack")).toBe(false);
    expect(abilities.send("attack")).toEqual({ ok: false, reason: "noMatch" });
    expect(abilities.active()?.phase).toBe("jab"); // no restart, no fallthrough
  });

  it('an undeclared intent falls through to cross-def entry and reports its refusal ("busy" without a window)', () => {
    const { pc, abilities } = setup([
      combo(),
      { id: "dash", timeline: [beep({ at: 0.1, id: "d" })] },
    ]);
    abilities.send("attack");
    pc._tick(0.1);
    expect(abilities.send("dash")).toEqual({ ok: false, reason: "busy" });
    expect(abilities.activeId()).toBe("attack");
  });

  it("an undeclared intent is admitted through the active phase's cancel window, cancelling the occupant", () => {
    const dashCombo: AbilityDef = {
      ...combo(),
      cancels: [{ from: 0.1, into: ["dash"] }],
    };
    const { entity, pc, abilities } = setup([
      dashCombo,
      { id: "dash", timeline: [beep({ at: 0.1, id: "d" })] },
    ]);
    const ended: boolean[] = [];
    entity.on(AbilityEnded, ({ cancelled }) => ended.push(cancelled));
    abilities.send("attack");
    const attack = abilities.active()!;
    pc._tick(0.3);
    expect(abilities.canSend("dash")).toBe(true);
    expect(abilities.send("dash")).toEqual(okResult);
    expect(abilities.activeId()).toBe("dash");
    expect(attack.state).toBe("cancelled"); // admission is a cancellation now
    expect(ended).toEqual([true]);
  });

  it("a transition closes the outgoing phase's windows with cancelled=false — flow, not interruption", () => {
    const { pc, abilities, log } = setup([
      {
        id: "a",
        phases: {
          one: {
            timeline: [zone({ from: 0, to: 1, id: "one" })],
            on: { go: "two" },
          },
          two: { timeline: [zone({ from: 0, to: 0.2, id: "two" })] },
        },
      },
    ]);
    abilities.send("a");
    pc._tick(0.4);
    expect(log).toEqual(["enter:one"]);
    abilities.send("go");
    expect(log).toEqual(["enter:one", "exit:one:false"]);
    pc._tick(0.01);
    expect(log).toEqual(["enter:one", "exit:one:false", "enter:two"]);
  });
});

describe("Abilities — linger", () => {
  const lingering = (): AbilityDef => ({
    id: "attack",
    cooldown: 5,
    phases: {
      jab: {
        timeline: [zone({ from: 0, to: 0.2, id: "jab" })],
        duration: 0.3,
        on: { attack: { to: "cross", from: 0.25, until: 0.6 } },
      },
      cross: { timeline: [beep({ at: 0.1, id: "cross" })], duration: 0.4 },
    },
  });

  it("a press after completion, within the guard's excess reach, starts a NEW activation at the target phase", () => {
    const { entity, pc, abilities } = setup([lingering()]);
    const started: AbilityActivation[] = [];
    entity.on(AbilityStarted, ({ activation }) => started.push(activation));

    const first = abilities.send("attack");
    if (!first.ok) throw new Error("expected send to succeed");
    pc._tick(0.3); // jab completes; guard reaches to 0.6 → 0.3s of linger
    expect(abilities.isActive()).toBe(false);
    pc._tick(0.1); // linger position 0.4 ∈ [0.25, 0.6]
    expect(abilities.canSend("attack")).toBe(true);
    const second = abilities.send("attack");
    if (!second.ok) throw new Error("expected linger send to succeed");
    expect(second.activation).not.toBe(first.activation); // a fresh run
    expect(second.activation.phase).toBe("cross");
    expect(started).toHaveLength(2);
  });

  it("a linger continuation neither checks nor re-arms the cooldown", () => {
    const { pc, abilities } = setup([lingering()]);
    abilities.send("attack"); // arms the 5s cooldown
    pc._tick(0.4); // completes; cooldown at 0.4/5
    expect(abilities.cooldownRemaining("attack")).toBeCloseTo(4.6);
    const result = abilities.send("attack"); // cooldown running, linger admits anyway
    expect(result).toEqual(okResult);
    // Not re-armed: still the original slot, aged past the continuation.
    expect(abilities.cooldownRemaining("attack")).toBeCloseTo(4.6);
  });

  it("the linger memory lapses once the reach ends, and a fresh entry pays cooldown again", () => {
    const { pc, abilities } = setup([lingering()]);
    abilities.send("attack");
    pc._tick(0.3); // completes at jab duration 0.3; reach = 0.6 - 0.3 = 0.3
    pc._tick(0.35); // position 0.65 > until 0.6 — memory self-completed
    expect(abilities.canSend("attack")).toBe(false);
    expect(abilities.send("attack")).toEqual({ ok: false, reason: "cooldown" });
  });

  it("a press at exactly `until` still lingers — the guard range is inclusive", () => {
    const { pc, abilities } = setup([
      {
        id: "attack",
        phases: {
          jab: {
            timeline: [],
            duration: 0.25,
            on: { attack: { to: "cross", from: 0.25, until: 0.75 } },
          },
          cross: { timeline: [], duration: 0.5 },
        },
      },
    ]);
    abilities.send("attack");
    pc._tick(0.25); // completes exactly at the jab's end; reach = 0.5
    pc._tick(0.5); // linger position = 0.25 + 0.5 = exactly `until`
    expect(abilities.canSend("attack")).toBe(true);
    const result = abilities.send("attack");
    if (!result.ok) throw new Error("expected send to succeed");
    expect(result.activation.phase).toBe("cross");
  });

  it("starting any ability on the lane clears its linger memory", () => {
    const { pc, abilities } = setup([
      lingering(),
      { id: "other", timeline: [zone({ from: 0, to: 0.2, id: "o" })] },
    ]);
    abilities.send("attack");
    pc._tick(0.3);
    abilities.send("other"); // fresh start resets flow state
    pc._tick(0.05);
    // A live memory would admit despite the running cooldown (linger skips
    // it); the "cooldown" refusal proves resolution fell through to entry.
    expect(abilities.send("attack")).toEqual({ ok: false, reason: "cooldown" });
    abilities.cancel();
    expect(abilities.send("attack")).toEqual({ ok: false, reason: "cooldown" });
  });

  it("a cancelled run arms no linger memory", () => {
    const { pc, abilities } = setup([lingering()]);
    abilities.send("attack");
    pc._tick(0.28); // inside the guard's from, but the run is cut short
    abilities.cancel();
    pc._tick(0.05);
    expect(abilities.canSend("attack")).toBe(false); // no memory; entry blocked by cooldown
  });
});

describe("Abilities — hold phases + release", () => {
  const guardDef = (): AbilityDef => ({
    id: "guard",
    phases: {
      hold: { hold: true, timeline: [zone({ from: 0, to: "end", id: "g" })] },
    },
  });

  it("runs open-ended until release, exits close as flow, and release returns true", () => {
    const { pc, abilities, log } = setup([guardDef()]);
    abilities.send("guard");
    pc._tick(0.05);
    expect(log).toEqual(["enter:g"]);
    pc._tick(5); // would end any finite ability; a hold stays active
    expect(abilities.isActive()).toBe(true);
    expect(abilities.active()?.phaseDuration).toBe(Infinity);

    expect(abilities.release("guard")).toBe(true);
    expect(log).toEqual(["enter:g", "exit:g:false"]);
    expect(abilities.isActive()).toBe(false);
    expect(abilities.release("guard")).toBe(false); // nothing held anymore
  });

  it("release emits AbilityEnded(cancelled: false) and leaves state completed when the hold has no next", () => {
    const { entity, pc, abilities } = setup([guardDef()]);
    const ended: boolean[] = [];
    entity.on(AbilityEnded, ({ cancelled }) => ended.push(cancelled));
    abilities.send("guard");
    const activation = abilities.active()!;
    pc._tick(0.1);
    abilities.release("guard");
    expect(ended).toEqual([false]);
    expect(activation.state).toBe("completed");
  });

  it("release of an intent that started no hold is a false no-op; a fixed-phase ability is untouched", () => {
    const { pc, abilities } = setup([
      guardDef(),
      { id: "swing", timeline: [zone({ from: 0, to: 0.5, id: "s" })] },
    ]);
    expect(abilities.release("guard")).toBe(false); // idle
    abilities.send("swing");
    pc._tick(0.1);
    expect(abilities.release("swing")).toBe(false); // no hold phase
    expect(abilities.isActive()).toBe(true);
    expect(abilities.activeId()).toBe("swing");
  });

  it("release routes through next like a natural end, keeping the same activation", () => {
    const { entity, pc, abilities } = setup([
      {
        id: "charge",
        phases: {
          charge: { hold: true, next: "kick", timeline: [] },
          kick: { timeline: [beep({ at: 0.1, id: "kick" })], duration: 0.3 },
        },
      },
    ]);
    const phases: string[] = [];
    entity.on(PhaseChanged, ({ from, to }) => phases.push(`${from}->${to}`));
    abilities.send("charge");
    const activation = abilities.active()!;
    pc._tick(0.4);
    expect(abilities.release("charge")).toBe(true);
    expect(abilities.active()).toBe(activation);
    expect(activation.phase).toBe("kick");
    expect(phases).toEqual(["charge->kick"]);
  });

  it("cancel on a hold closes it with cancelled=true", () => {
    const { pc, abilities, log } = setup([guardDef()]);
    abilities.send("guard");
    pc._tick(0.1);
    abilities.cancel();
    expect(log).toEqual(["enter:g", "exit:g:true"]);
    expect(abilities.active()).toBeNull();
  });

  it("every ticks a hold's open-ended window at its interval while held, and stops on release", () => {
    const { pc, abilities, log } = setup([
      {
        id: "charge",
        phases: {
          main: {
            hold: true,
            timeline: [zone({ from: 0, to: "end", every: 0.1, id: "c" })],
          },
        },
      },
    ]);
    abilities.send("charge");
    pc._tick(0.1); // enter + tick@0.1
    pc._tick(0.1); // tick@0.2
    pc._tick(0.1); // tick@0.3
    pc._tick(0.05); // 0.35 — no tick
    expect(log).toEqual(["enter:c", "tick:c", "tick:c", "tick:c"]);
    abilities.release("charge");
    expect(log).toContain("exit:c:false");
    pc._tick(0.2); // released — no further ticks
    expect(log.filter((e) => e === "tick:c")).toHaveLength(3);
  });

  it("elastic ticks follow the phase clock: a capped hold consumed by one big tick still delivers every tick", () => {
    const { pc, abilities, log } = setup([
      {
        id: "charge",
        phases: {
          main: {
            hold: { max: 0.5 },
            timeline: [zone({ from: 0, to: "end", every: 0.1, id: "c" })],
          },
        },
      },
    ]);
    abilities.send("charge");
    pc._tick(0.5); // one frame swallows the whole hold
    // Catch-up like a compiled window: ticks at 0.1/0.2/0.3/0.4, none on the
    // 0.5 boundary itself (half-open), then the hold.max close.
    expect(log).toEqual([
      "enter:c",
      "tick:c",
      "tick:c",
      "tick:c",
      "tick:c",
      "exit:c:false",
    ]);
  });

  it("a window opening mid-tick doesn't tick early: cadence is measured on the phase clock, not the frame", () => {
    const { pc, abilities, log } = setup([
      {
        id: "charge",
        phases: {
          main: {
            hold: true,
            timeline: [zone({ from: 0.05, to: "end", every: 0.07, id: "c" })],
          },
        },
      },
    ]);
    abilities.send("charge");
    pc._tick(0.1); // window opened at 0.05; first tick is due at 0.12, not "0.1 seconds after enter"
    expect(log).toEqual(["enter:c"]);
    pc._tick(0.02); // position 0.12
    expect(log).toEqual(["enter:c", "tick:c"]);
  });

  it("hold.max auto-completes into next", () => {
    const { pc, abilities } = setup([
      {
        id: "charge",
        phases: {
          charge: { hold: { max: 0.5 }, next: "kick", timeline: [] },
          kick: { timeline: [beep({ at: 0.05, id: "k" })], duration: 0.3 },
        },
      },
    ]);
    abilities.send("charge");
    pc._tick(0.6); // past max
    expect(abilities.active()?.phase).toBe("kick");
    expect(abilities.release("charge")).toBe(false); // the hold already completed
  });

  it("an after ladder advances while held, carrying the intent binding into the next hold", () => {
    const megaman = (): AbilityDef => ({
      id: "buster",
      phases: {
        charge1: {
          hold: true,
          next: "shot1",
          after: { at: 0.7, to: "charge2" },
          timeline: [],
        },
        charge2: { hold: true, next: "shot2", timeline: [] },
        shot1: { timeline: [beep({ at: 0.05, id: "s1" })], duration: 0.2 },
        shot2: { timeline: [beep({ at: 0.05, id: "s2" })], duration: 0.2 },
      },
    });
    const { pc, abilities } = setup([megaman()]);
    abilities.send("buster");
    pc._tick(0.3); // still charge1
    expect(abilities.release("buster")).toBe(true);
    expect(abilities.active()?.phase).toBe("shot1"); // early release → tier 1
    pc._tick(0.3); // shot1 completes

    abilities.send("buster");
    pc._tick(0.8); // after fires at 0.7 → charge2, binding carried
    expect(abilities.active()?.phase).toBe("charge2");
    expect(abilities.release("buster")).toBe(true); // the carried binding completes tier 2
    expect(abilities.active()?.phase).toBe("shot2");
  });

  it("same-frame timer-vs-release: the timer has already advanced, so release lands on the higher tier", () => {
    const { pc, abilities } = setup([
      {
        id: "buster",
        phases: {
          charge1: {
            hold: true,
            next: "shot1",
            after: { at: 0.7, to: "charge2" },
            timeline: [],
          },
          charge2: { hold: true, next: "shot2", timeline: [] },
          shot1: { timeline: [], duration: 0.2 },
          shot2: { timeline: [], duration: 0.2 },
        },
      },
    ]);
    abilities.send("buster");
    // One frame in which BOTH the 0.7s threshold passes and the key is
    // released: ability processes tick first (Update/500), the controller's
    // release lands after (Update/1000) — the timer wins.
    pc._tick(0.75);
    expect(abilities.active()?.phase).toBe("charge2");
    expect(abilities.release("buster")).toBe(true);
    expect(abilities.active()?.phase).toBe("shot2");
  });

  it("an enter hook that transitions away doesn't leak the old elastic window's ticks into the next phase", () => {
    const hijackZone = defineStep<{ id: string }>("hijackZone", {
      enter: (params, ctx) => {
        log(ctx).push(`enter:${params.id}`);
        ctx.abilities.send("go");
      },
      exit: (params, ctx, cancelled) =>
        log(ctx).push(`exit:${params.id}:${cancelled}`),
      tick: (params, ctx) => log(ctx).push(`tick:${params.id}`),
    });
    // Destructured as `entries` so the step above still resolves `log` to
    // the module-level helper, not this array.
    const {
      pc,
      abilities,
      log: entries,
    } = setup([
      {
        id: "a",
        phases: {
          one: {
            hold: true,
            on: { go: "two" },
            timeline: [hijackZone({ from: 0, to: "end", every: 0.05, id: "h" })],
          },
          two: { timeline: [], duration: 1 },
        },
      },
    ]);
    abilities.send("a");
    pc._tick(0.1); // enter fires → its hook transitions → the window closes as flow
    expect(abilities.active()?.phase).toBe("two");
    expect(entries).toEqual(["enter:h", "exit:h:false"]);
    pc._tick(0.3); // no ticks may survive into phase two
    expect(entries).toEqual(["enter:h", "exit:h:false"]);
  });

  it("a force()-entered hold has no binding and never releases", () => {
    const def = guardDef();
    const { pc, abilities } = setup([]);
    abilities.force(def);
    pc._tick(0.1);
    expect(abilities.release("guard")).toBe(false);
    expect(abilities.isActive()).toBe(true);
  });
});

describe("Abilities — entry doors + payload", () => {
  const chargeWithDoor = (): AbilityDef => ({
    id: "charge",
    cooldown: 0.2,
    entry: { "attack-release": "kick" },
    phases: {
      charge: { hold: { max: 3 }, next: "kick", timeline: [] },
      kick: { timeline: [beep({ at: 0.05, id: "k" })], duration: 0.5 },
    },
  });

  it("an entry alias enters at its door phase with the payload on the handle", () => {
    const { pc, abilities } = setup([chargeWithDoor()]);
    const result = abilities.send("attack-release", 1.4);
    if (!result.ok) throw new Error("expected send to succeed");
    expect(result.activation.phase).toBe("kick");
    expect(result.activation.payload).toBe(1.4);
    pc._tick(0.1);
    expect(abilities.activeId()).toBe("charge");
  });

  it("an entry door pays the def's cooldown like any entry", () => {
    const { pc, abilities } = setup([{ ...chargeWithDoor(), cooldown: 5 }]);
    abilities.send("attack-release");
    pc._tick(0.6); // kick completes at 0.5; the 5s cooldown still runs
    expect(abilities.send("attack-release")).toEqual({
      ok: false,
      reason: "cooldown",
    });
  });

  it("elapsedIn accumulates per visited phase and reads 0 for unvisited phases", () => {
    const { pc, abilities } = setup([
      {
        id: "combo",
        phases: {
          jab: {
            timeline: [],
            duration: 1,
            on: { again: "jab", go: "cross" },
          },
          cross: { timeline: [], duration: 1 },
        },
      },
    ]);
    abilities.send("combo");
    const activation = abilities.active()!;
    pc._tick(0.3);
    abilities.send("again"); // re-enter jab
    pc._tick(0.2);
    expect(activation.elapsedIn("jab")).toBeCloseTo(0.5); // 0.3 + 0.2 across visits
    expect(activation.elapsedIn("cross")).toBe(0); // unvisited
    abilities.send("go");
    pc._tick(0.4);
    expect(activation.elapsedIn("cross")).toBeCloseTo(0.4);
    expect(activation.elapsedIn("jab")).toBeCloseTo(0.5); // frozen once left
    expect(activation.elapsed).toBeCloseTo(0.9);
  });

  it("a transition send with data updates the payload; without data it is left alone", () => {
    const { pc, abilities } = setup([
      {
        id: "a",
        phases: {
          one: { timeline: [], duration: 1, on: { go: "two", jump: "three" } },
          two: { timeline: [], duration: 1, on: { jump: "three" } },
          three: { timeline: [], duration: 1 },
        },
      },
    ]);
    const result = abilities.send("a", "entry-data");
    if (!result.ok) throw new Error("expected send to succeed");
    pc._tick(0.1);
    abilities.send("go");
    expect(result.activation.payload).toBe("entry-data"); // no data → untouched
    pc._tick(0.1);
    abilities.send("jump", 42);
    expect(result.activation.payload).toBe(42);
  });
});

describe('Abilities — windows ending at "end"', () => {
  it("closes at the fixed phase's boundary — the explicit duration, not the last step", () => {
    const { pc, abilities, log } = setup([
      {
        id: "swing",
        duration: 0.5,
        timeline: [
          zone({ from: 0, to: "end", id: "g" }),
          beep({ at: 0.2, id: "mid" }),
        ],
      },
    ]);
    abilities.send("swing");
    pc._tick(0.3);
    expect(log).toEqual(["enter:g", "fire:mid"]);
    pc._tick(0.2); // 0.5 — the boundary
    expect(log).toEqual(["enter:g", "fire:mid", "exit:g:false"]);
    expect(abilities.isActive()).toBe(false);
  });

  it("in a hold phase it is elastic: closed by release with cancelled=false, by cancel with true", () => {
    const guardDef = (): AbilityDef => ({
      id: "guard",
      phases: {
        hold: { hold: true, timeline: [zone({ from: 0, to: "end", id: "g" })] },
      },
    });
    const first = setup([guardDef()]);
    first.abilities.send("guard");
    first.pc._tick(2);
    first.abilities.release("guard");
    expect(first.log).toEqual(["enter:g", "exit:g:false"]);

    const second = setup([guardDef()]);
    second.abilities.send("guard");
    second.pc._tick(2);
    second.abilities.cancel();
    expect(second.log).toEqual(["enter:g", "exit:g:true"]);
  });

  it("an interrupt closes it with cancelled=true", () => {
    const { pc, abilities, log } = setup([
      {
        id: "guard",
        phases: {
          hold: {
            hold: true,
            timeline: [zone({ from: 0, to: "end", id: "g" })],
          },
        },
      },
      { id: "big", priority: 10, timeline: [beep({ at: 0.1, id: "b" })] },
    ]);
    abilities.send("guard");
    pc._tick(0.2);
    abilities.send("big");
    expect(log).toEqual(["enter:g", "exit:g:true"]);
  });
});

describe("Abilities — cancel windows", () => {
  const swingWithCancel = (cancels: object[]): AbilityDef => ({
    id: "swing",
    timeline: [zone({ from: 0, to: 0.4, id: "s" })],
    cancels: cancels as never,
  });

  it("admits a send() inside the window, cancelling the predecessor", () => {
    const { entity, pc, abilities } = setup([
      swingWithCancel([{ from: 0.2, into: ["dash"] }]),
      { id: "dash", timeline: [beep({ at: 0, id: "d" })] },
    ]);
    const ended: Array<{ id: string; cancelled: boolean }> = [];
    entity.on(AbilityEnded, ({ activation, cancelled }) =>
      ended.push({ id: activation.def.id, cancelled }),
    );
    abilities.send("swing");
    const swing = abilities.active()!;
    pc._tick(0.1); // elapsed 0.1 — before the window
    expect(abilities.send("dash")).toEqual({ ok: false, reason: "busy" });
    pc._tick(0.15); // elapsed 0.25 — inside [0.2, end]
    expect(abilities.send("dash")).toEqual(okResult);
    expect(abilities.activeId()).toBe("dash");
    expect(swing.state).toBe("cancelled");
    expect(ended).toEqual([{ id: "swing", cancelled: true }]);
  });

  it("an admission runs the predecessor's exit hooks with cancelled=true", () => {
    const { pc, abilities, log } = setup([
      swingWithCancel([{ from: 0 }]), // omitted `into` = admits any
      { id: "dash", timeline: [beep({ at: 0, id: "d" })] },
    ]);
    abilities.send("swing");
    pc._tick(0.1);
    abilities.send("dash");
    expect(log).toEqual(["enter:s", "exit:s:true"]);
  });

  it("only admits ids in `into`; others stay busy", () => {
    const { pc, abilities } = setup([
      swingWithCancel([{ from: 0, into: ["dash"] }]),
      { id: "dash", timeline: [beep({ at: 0, id: "d" })] },
      { id: "roll", timeline: [beep({ at: 0, id: "r" })] },
    ]);
    abilities.send("swing");
    pc._tick(0.1);
    expect(abilities.send("roll")).toEqual({ ok: false, reason: "busy" });
    expect(abilities.send("dash")).toEqual(okResult);
  });

  it("ORs exact ids and definition tags while refusing unrelated definitions", () => {
    const { pc, abilities } = setup([
      swingWithCancel([{ from: 0, into: ["parry", { tag: "movement" }] }]),
      {
        id: "dash",
        tags: ["movement"],
        timeline: [beep({ at: 0, id: "d" })],
      },
      { id: "parry", timeline: [beep({ at: 0, id: "p" })] },
      {
        id: "spell",
        tags: ["magic"],
        timeline: [beep({ at: 0, id: "m" })],
      },
    ]);
    abilities.send("swing");
    pc._tick(0.1);

    expect(abilities.canSend("spell")).toBe(false);
    expect(abilities.send("spell")).toEqual({ ok: false, reason: "busy" });
    expect(abilities.canSend("parry")).toBe(true);
    expect(abilities.canSend("dash")).toBe(true);
    expect(abilities.send("dash")).toEqual(okResult);
  });

  it("`into` matches the resolved def id, not the intent alias used to reach it", () => {
    const { pc, abilities } = setup([
      swingWithCancel([{ from: 0, into: ["dash"] }]),
      {
        id: "dash",
        entry: { evade: "main" },
        timeline: [beep({ at: 0, id: "d" })],
      },
    ]);
    abilities.send("swing");
    pc._tick(0.1);
    expect(abilities.send("evade")).toEqual(okResult); // alias resolves to "dash"
    expect(abilities.activeId()).toBe("dash");
  });

  it("tag matching reads the resolved definition behind an intent alias", () => {
    const { pc, abilities } = setup([
      swingWithCancel([{ from: 0, into: [{ tag: "movement" }] }]),
      {
        id: "dash",
        tags: ["movement"],
        entry: { evade: "main" },
        timeline: [beep({ at: 0, id: "d" })],
      },
    ]);
    abilities.send("swing");
    pc._tick(0.1);
    expect(abilities.canSend("evade")).toBe(true);
    expect(abilities.send("evade")).toEqual(okResult);
    expect(abilities.activeId()).toBe("dash");
  });

  it("omitted / ['*'] into admits any id including the def itself (mash-restart)", () => {
    const { pc, abilities } = setup([swingWithCancel([{ from: 0, to: 0.4 }])]);
    abilities.send("swing");
    const first = abilities.active()!;
    pc._tick(0.1);
    expect(abilities.send("swing")).toEqual(okResult);
    expect(first.state).toBe("cancelled");
    expect(abilities.active()).not.toBe(first);
    expect(abilities.activeId()).toBe("swing");
  });

  it("stays busy outside the window's [from, to] bounds", () => {
    const { pc, abilities } = setup([
      swingWithCancel([{ from: 0.1, to: 0.2, into: ["dash"] }]),
      { id: "dash", timeline: [beep({ at: 0, id: "d" })] },
    ]);
    abilities.send("swing");
    pc._tick(0.3); // elapsed 0.3 — past to=0.2
    expect(abilities.send("dash")).toEqual({ ok: false, reason: "busy" });
  });

  it("admits a force() inside the window even when priority does not outrank", () => {
    const { pc, abilities } = setup([
      swingWithCancel([{ from: 0, into: [{ tag: "movement" }] }]),
    ]);
    const dash: AbilityDef = {
      id: "dash",
      tags: ["movement"],
      priority: 0,
      timeline: [beep({ at: 0, id: "d" })],
    };
    abilities.send("swing");
    const swing = abilities.active()!;
    pc._tick(0.1);
    expect(abilities.force(dash)).toEqual(okResult);
    expect(swing.state).toBe("cancelled");
    expect(abilities.activeId()).toBe("dash");
  });

  it("cancel windows are phase-local: a later phase re-runs its own spans", () => {
    const { pc, abilities } = setup([
      {
        id: "combo",
        cancels: [{ from: 0.2, into: ["dash"] }], // def-level sugar → every phase
        phases: {
          jab: { timeline: [], duration: 0.3, on: { go: "cross" } },
          cross: { timeline: [], duration: 0.3 },
        },
      },
      { id: "dash", timeline: [beep({ at: 0, id: "d" })] },
    ]);
    abilities.send("combo");
    pc._tick(0.25); // jab-local 0.25 ≥ 0.2 → admissible
    abilities.send("go"); // → cross; its local clock restarts
    expect(abilities.send("dash")).toEqual({ ok: false, reason: "busy" }); // cross-local 0 < 0.2
    pc._tick(0.25);
    expect(abilities.send("dash")).toEqual(okResult); // cross-local 0.25 ≥ 0.2
  });
});

describe("Abilities — mid-tick interruption + phase-token guards", () => {
  it("an interrupt from inside a hook silences the rest of that tick's due events on the interrupted activation", () => {
    const reactionDef: AbilityDef = {
      id: "reaction",
      priority: 10,
      timeline: [zone({ from: 0, to: 5, id: "reaction-zone" })],
    };
    const interrupt = defineStep<{ id: string }>("interrupt", {
      fire: (_params, ctx) => {
        log(ctx).push("interrupt");
        ctx.abilities.force(reactionDef);
      },
    });
    // Destructured as `entries` (not `log`) so the `interrupt` step above still
    // resolves `log` to the module-level helper, not this array.
    const {
      pc,
      abilities,
      log: entries,
    } = setup([
      {
        id: "a",
        timeline: [
          zone({ from: 0, to: 0.3, id: "z" }),
          interrupt({ at: 0.1, id: "i" }),
          beep({ at: 0.15, id: "late" }),
        ],
      },
    ]);
    abilities.send("a");
    pc._tick(0.2); // one tick spans both the interrupt at 0.1 and the late point at 0.15
    expect(entries.slice(0, 3)).toEqual([
      "enter:z",
      "interrupt",
      "exit:z:true",
    ]);
    expect(entries).not.toContain("fire:late");
    expect(abilities.activeId()).toBe("reaction");
  });

  it("a transition from inside a hook makes the old phase's later same-tick events inert", () => {
    const advance = defineStep<{ id: string }>("advance", {
      fire: (_params, ctx) => {
        log(ctx).push("advance");
        ctx.abilities.send("go");
      },
    });
    // Destructured as `entries` so the `advance` step above still resolves
    // `log` to the module-level helper, not this array.
    const {
      pc,
      abilities,
      log: entries,
    } = setup([
      {
        id: "a",
        phases: {
          one: {
            timeline: [
              zone({ from: 0, to: 0.3, id: "z" }),
              advance({ at: 0.1, id: "adv" }),
              beep({ at: 0.15, id: "late" }), // due this tick, must not fire
            ],
            on: { go: "two" },
          },
          two: { timeline: [beep({ at: 0.05, id: "two" })], duration: 0.3 },
        },
      },
    ]);
    abilities.send("a");
    pc._tick(0.2);
    expect(entries).toEqual(["enter:z", "advance", "exit:z:false", "fire:two"]);
    expect(entries).not.toContain("fire:late");
    expect(abilities.active()?.phase).toBe("two");
  });

  it("a phase entered mid-tick receives only the tick's remainder, not the full dt again", () => {
    const { pc, abilities, log } = setup([
      {
        id: "a",
        phases: {
          one: { timeline: [], duration: 0.2, next: "two" },
          two: { timeline: [beep({ at: 0.15, id: "b" })], duration: 0.5 },
        },
      },
    ]);
    abilities.send("a");
    pc._tick(0.3); // one completes at 0.2; two gets the 0.1 remainder only
    expect(abilities.active()?.phase).toBe("two");
    expect(abilities.active()?.phaseElapsed).toBeCloseTo(0.1);
    expect(log).toEqual([]); // 0.15 not reached — the full 0.3 was NOT re-applied
    pc._tick(0.04);
    expect(log).toEqual([]); // 0.14
    pc._tick(0.01);
    expect(log).toEqual(["fire:b"]); // exactly at 0.15 on two's own clock
  });

  it("an event-driven transition mid-tick folds only up to its firing instant — no double count", () => {
    const { pc, abilities } = setup([
      {
        id: "a",
        phases: {
          one: { timeline: [], duration: 1, after: { at: 0.1, to: "two" } },
          two: { timeline: [], duration: 1 },
        },
      },
    ]);
    abilities.send("a");
    const activation = abilities.active()!;
    pc._tick(0.2); // after fires at 0.1; the remaining 0.1 belongs to two
    expect(activation.phase).toBe("two");
    expect(activation.elapsedIn("one")).toBeCloseTo(0.1);
    expect(activation.elapsedIn("two")).toBeCloseTo(0.1);
    expect(activation.elapsed).toBeCloseTo(0.2); // == real game time passed
  });

  it("an exit hook that transitions the same activation during cancel doesn't orphan the new phase's track", () => {
    const hijack = defineStep<object>("hijack", {
      exit: (_params, ctx) => {
        ctx.abilities.send("go");
      },
    });
    const { entity, pc, abilities, log } = setup([
      {
        id: "a",
        phases: {
          one: { timeline: [hijack({ from: 0, to: 1 })], on: { go: "two" } },
          two: { timeline: [beep({ at: 0.05, id: "two" })], duration: 0.5 },
        },
      },
    ]);
    const events: string[] = [];
    entity.on(PhaseChanged, ({ from, to }) => events.push(`phase:${from}->${to}`));
    entity.on(AbilityEnded, ({ cancelled }) => events.push(`ended:${cancelled}`));

    abilities.send("a");
    const activation = abilities.active()!;
    pc._tick(0.1); // open the window so cancel runs the hijacking exit hook
    abilities.cancel();

    expect(activation.state).toBe("cancelled"); // the end wins over the nested transition
    expect(abilities.active()).toBeNull();
    // Zero-time phase entry then the end — delivered as history, in order.
    expect(events).toEqual(["phase:one->two", "ended:true"]);
    pc._tick(0.1);
    expect(log).not.toContain("fire:two"); // two's track was voided, not orphaned
    expect(pc.count).toBe(0); // nothing left ticking in the ProcessComponent
  });

  it("a next chain across several phases in one big tick keeps a continuous clock", () => {
    const { pc, abilities, log } = setup([
      {
        id: "a",
        phases: {
          one: { timeline: [beep({ at: 0.1, id: "1" })], duration: 0.2, next: "two" },
          two: { timeline: [beep({ at: 0.1, id: "2" })], duration: 0.2, next: "three" },
          three: { timeline: [beep({ at: 0.1, id: "3" })], duration: 0.2 },
        },
      },
    ]);
    abilities.send("a");
    pc._tick(0.55); // 0.2 + 0.2 + 0.15 — lands mid-three, past its 0.1 beep
    expect(log).toEqual(["fire:1", "fire:2", "fire:3"]);
    expect(abilities.active()?.phase).toBe("three");
    expect(abilities.active()?.phaseElapsed).toBeCloseTo(0.15);
    expect(abilities.active()?.elapsed).toBeCloseTo(0.55);
  });
});

describe("Abilities — transition re-entrancy (generation counter)", () => {
  it("an exit hook that sends during a transition supersedes it: the outer transition aborts, one settled phase, one PhaseChanged", () => {
    const hijack = defineStep<object>("hijack", {
      exit: (_params, ctx) => {
        ctx.abilities.send("swerve");
      },
    });
    const { entity, pc, abilities, log } = setup([
      {
        id: "a",
        phases: {
          one: {
            timeline: [hijack({ from: 0, to: 1 })],
            on: { go: "two", swerve: "three" },
          },
          two: { timeline: [beep({ at: 0.05, id: "two" })], duration: 0.3 },
          three: { timeline: [beep({ at: 0.05, id: "three" })], duration: 0.3 },
        },
      },
    ]);
    const phases: string[] = [];
    entity.on(PhaseChanged, ({ from, to }) => phases.push(`${from}->${to}`));

    abilities.send("a");
    pc._tick(0.1); // open the window so the transition has an exit hook to run
    abilities.send("go"); // closing one's windows fires hijack → send("swerve")

    expect(abilities.active()?.phase).toBe("three"); // the nested transition won
    expect(phases).toEqual(["one->three"]); // one->two never emitted
    pc._tick(0.06);
    expect(log).toContain("fire:three"); // three's track runs — no orphan
    expect(log).not.toContain("fire:two"); // two's track never started
  });

  it("an exit hook that forces a replacement during a transition ends the activation instead — no orphaned track, exactly one Ended", () => {
    const c: AbilityDef = {
      id: "c",
      priority: 50,
      timeline: [beep({ at: 0, id: "c" })],
    };
    const forceC = defineStep<object>("forceC", {
      exit: (_params, ctx) => ctx.abilities.force(c),
    });
    const { entity, pc, abilities } = setup([
      {
        id: "a",
        phases: {
          one: { timeline: [forceC({ from: 0, to: 1 })], on: { go: "two" } },
          two: { timeline: [beep({ at: 0.05, id: "two" })], duration: 0.3 },
        },
      },
    ]);
    const events: string[] = [];
    entity.on(AbilityStarted, ({ activation }) =>
      events.push(`started:${activation.def.id}`),
    );
    entity.on(AbilityEnded, ({ activation }) =>
      events.push(`ended:${activation.def.id}`),
    );
    entity.on(PhaseChanged, ({ from, to }) => events.push(`phase:${from}->${to}`));

    abilities.send("a");
    pc._tick(0.1);
    events.length = 0;
    abilities.send("go"); // exit hook forces c (priority 50 > 0) → a is gone; outer transition aborts

    expect(events).toEqual(["ended:a", "started:c"]); // no phase event for the aborted transition
    expect(abilities.activeId()).toBe("c");
    events.length = 0;
    pc._tick(0.01); // c completes on its own — installed for real, not orphaned
    expect(events).toEqual(["ended:c"]);
  });

  it("send() loops the admission rule against a mid-cancel replacement: A -> C (installed by A's exit hook) -> B", () => {
    const c: AbilityDef = {
      id: "c",
      priority: 50,
      timeline: [beep({ at: 0, id: "c" })],
    };
    const forceC = defineStep<object>("forceC", {
      exit: (_params, ctx) => ctx.abilities.force(c),
    });
    const { entity, pc, abilities } = setup([
      { id: "a", timeline: [forceC({ from: 0, to: 1 })] },
      { id: "b", priority: 100, timeline: [beep({ at: 0, id: "b" })] },
    ]);
    const events: string[] = [];
    entity.on(AbilityStarted, ({ activation }) =>
      events.push(`started:${activation.def.id}`),
    );
    entity.on(AbilityEnded, ({ activation }) =>
      events.push(`ended:${activation.def.id}`),
    );

    abilities.send("a");
    pc._tick(0.1); // open a's window, so cancelling it below runs the exit hook
    events.length = 0;
    const result = abilities.send("b");
    if (!result.ok) throw new Error("expected send to succeed");

    // b's admission cancels a; a's exit hook installs c (out-competing a);
    // b's loop then re-contests against c (the real current occupant) and wins.
    expect(events).toEqual(["ended:a", "started:c", "ended:c", "started:b"]);
    expect(abilities.active()).toBe(result.activation);
  });

  it("a refusal reached against the replacement is still a refusal — the replacement stays installed and later completes", () => {
    const c: AbilityDef = {
      id: "c",
      priority: 50,
      timeline: [beep({ at: 0, id: "c" })],
    };
    const forceC = defineStep<object>("forceC", {
      exit: (_params, ctx) => ctx.abilities.force(c),
    });
    const { entity, pc, abilities } = setup([
      { id: "a", timeline: [forceC({ from: 0, to: 1 })] },
      { id: "b", priority: 10, timeline: [beep({ at: 0, id: "b" })] },
    ]);
    const events: string[] = [];
    entity.on(AbilityStarted, ({ activation }) =>
      events.push(`started:${activation.def.id}`),
    );
    entity.on(AbilityEnded, ({ activation }) =>
      events.push(`ended:${activation.def.id}`),
    );

    abilities.send("a");
    pc._tick(0.1);
    events.length = 0;
    const result = abilities.send("b"); // b (priority 10) loses to c (priority 50), not a

    expect(result).toEqual({ ok: false, reason: "busy" });
    expect(events).toEqual(["ended:a", "started:c"]); // a's cancellation ran; b never touched c
    expect(abilities.activeId()).toBe("c");

    events.length = 0;
    pc._tick(0.01); // c keeps running, untouched by the refusal, and completes on its own
    expect(events).toEqual(["ended:c"]);
    expect(abilities.active()).toBeNull();
  });
});

describe("Abilities — lifecycle events + activation handle", () => {
  it("the same AbilityActivation object appears on PlayResult, StepContext, active(), and both lifecycle events", () => {
    let ctxActivation: AbilityActivation | undefined;
    const capture = defineStep<object>("capture", {
      fire: (_params, ctx) => {
        ctxActivation = ctx.activation;
      },
    });
    const { entity, pc, abilities } = setup([
      {
        id: "test",
        timeline: [capture({ at: 0 }), beep({ at: 0.2, id: "end" })],
      },
    ]);
    const started: AbilityActivation[] = [];
    const ended: AbilityActivation[] = [];
    entity.on(AbilityStarted, ({ activation }) => started.push(activation));
    entity.on(AbilityEnded, ({ activation }) => ended.push(activation));

    const result = abilities.send("test");
    if (!result.ok) throw new Error("expected send to succeed");
    pc._tick(0.05);

    expect(ctxActivation).toBe(result.activation);
    expect(started[0]).toBe(result.activation);
    expect(abilities.active()).toBe(result.activation);

    pc._tick(0.2);
    expect(ended[0]).toBe(result.activation);
    expect(abilities.active()).toBeNull();
  });

  it("PlayResult.activation carries the new run's def, lane, and start phase", () => {
    const { abilities } = setup([
      { id: "test", lane: "side", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    const result = abilities.send("test");
    if (!result.ok) throw new Error("expected send to succeed");
    expect(result.activation.def.id).toBe("test");
    expect(result.activation.lane).toBe("side");
    expect(result.activation.phase).toBe("main");
    expect(result.activation.forced).toBe(false);
    expect(result.activation.state).toBe("active");
    expect(result.activation.payload).toBeUndefined();
  });

  it("phaseDuration is the resolved value even when duration is omitted", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [zone({ from: 0, to: 0.5, id: "z" })] },
    ]);
    abilities.send("test");
    pc._tick(0.1);
    expect(abilities.active()?.phaseDuration).toBeCloseTo(0.5);
    expect(abilities.active()?.phaseElapsed).toBeCloseTo(0.1);
  });

  it("elapsed clamps to the phase graph's real time even when a tick overshoots", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    abilities.send("test");
    const activation = abilities.active()!;
    pc._tick(1); // massively overshoots the ~0.1s duration in one tick
    expect(activation.elapsed).toBeCloseTo(0.1);
    expect(activation.state).toBe("completed");
  });

  it("cancel flips state to cancelled and freezes elapsed at the moment of cancel", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [zone({ from: 0, to: 1, id: "z" })] },
    ]);
    abilities.send("test");
    const activation = abilities.active()!;
    pc._tick(0.3);
    abilities.cancel();
    expect(activation.state).toBe("cancelled");
    expect(activation.elapsed).toBeCloseTo(0.3);
    pc._tick(0.5); // nothing left running — must not move the frozen value
    expect(activation.elapsed).toBeCloseTo(0.3);
  });

  it("destroying the entity flips state to cancelled but drops the AbilityEnded event", () => {
    const { entity, scene, pc, abilities } = setup([
      { id: "test", timeline: [zone({ from: 0, to: 1, id: "z" })] },
    ]);
    abilities.send("test");
    const activation = abilities.active()!;
    pc._tick(0.2);
    const ended: AbilityActivation[] = [];
    entity.on(AbilityEnded, ({ activation: a }) => ended.push(a));

    entity.destroy();
    scene._flushDestroyQueue();

    expect(activation.state).toBe("cancelled");
    expect(ended).toEqual([]);
  });

  it("emits Started then Ended(cancelled: false) for a run that completes naturally; state is already terminal when Ended fires", () => {
    const { entity, pc, abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    const events: string[] = [];
    let stateDuringEnded: string | undefined;
    entity.on(AbilityStarted, () => events.push("started"));
    entity.on(AbilityEnded, ({ activation, cancelled }) => {
      events.push(`ended:${cancelled}`);
      stateDuringEnded = activation.state;
    });

    abilities.send("test");
    pc._tick(0.1);

    expect(events).toEqual(["started", "ended:false"]);
    expect(stateDuringEnded).toBe("completed");
  });

  it("emits Ended(cancelled: true) for a cancelled run; state is already terminal when Ended fires", () => {
    const { entity, pc, abilities } = setup([
      { id: "test", timeline: [zone({ from: 0, to: 1, id: "z" })] },
    ]);
    const events: string[] = [];
    let stateDuringEnded: string | undefined;
    entity.on(AbilityStarted, () => events.push("started"));
    entity.on(AbilityEnded, ({ activation, cancelled }) => {
      events.push(`ended:${cancelled}`);
      stateDuringEnded = activation.state;
    });

    abilities.send("test");
    pc._tick(0.1);
    abilities.cancel();

    expect(events).toEqual(["started", "ended:true"]);
    expect(stateDuringEnded).toBe("cancelled");
  });

  it("an interrupt delivers Ended(old) then Started(new); active() already shows the new run's own object during Ended(old)", () => {
    const { entity, abilities } = setup([
      { id: "a", timeline: [zone({ from: 0, to: 1, id: "z" })] },
      { id: "b", priority: 10, timeline: [beep({ at: 0.5, id: "b" })] },
    ]);
    const events: string[] = [];
    let activeDuringEndedA: AbilityActivation | null = null;
    entity.on(AbilityStarted, ({ activation }) =>
      events.push(`started:${activation.def.id}`),
    );
    entity.on(AbilityEnded, ({ activation }) => {
      events.push(`ended:${activation.def.id}`);
      if (activation.def.id === "a") activeDuringEndedA = abilities.active();
    });

    abilities.send("a");
    events.length = 0; // drop the initial "started:a" noise
    const result = abilities.send("b");
    if (!result.ok) throw new Error("expected send to succeed");

    expect(events).toEqual(["ended:a", "started:b"]);
    // Identity, not just the id string: the exact same handle `send("b")`
    // returned is already installed and readable during Ended(a).
    expect(activeDuringEndedA).toBe(result.activation);
  });

  it("force() restarting the same def emits Ended(cancelled: true) then Started for a fresh handle", () => {
    const { entity, abilities } = setup([]);
    const reactionDef: AbilityDef = {
      id: "r",
      priority: 5,
      timeline: [zone({ from: 0, to: 1, id: "z" })],
    };
    const events: string[] = [];
    entity.on(AbilityStarted, () => events.push("started"));
    entity.on(AbilityEnded, ({ cancelled }) =>
      events.push(`ended:${cancelled}`),
    );

    abilities.force(reactionDef);
    const first = abilities.active();
    events.length = 0;
    abilities.force(reactionDef);
    const second = abilities.active();

    expect(events).toEqual(["ended:true", "started"]);
    expect(second).not.toBe(first);
  });

  it("a listener that reacts to Started by forcing another ability sees causal FIFO order, not a synchronous inversion", () => {
    const { entity, abilities } = setup([
      { id: "a", timeline: [zone({ from: 0, to: 5, id: "za" })] },
      { id: "b", priority: 10, timeline: [zone({ from: 0, to: 5, id: "zb" })] },
    ]);
    const c: AbilityDef = {
      id: "c",
      priority: 20,
      timeline: [beep({ at: 0, id: "c" })],
    };
    const events: string[] = [];
    entity.on(AbilityStarted, ({ activation }) => {
      events.push(`started:${activation.def.id}`);
      if (activation.def.id === "b") abilities.force(c);
    });
    entity.on(AbilityEnded, ({ activation }) =>
      events.push(`ended:${activation.def.id}`),
    );

    abilities.send("a");
    events.length = 0;
    abilities.send("b");

    expect(events).toEqual(["ended:a", "started:b", "ended:b", "started:c"]);
  });

  it("a PhaseChanged listener observes the settled lane state (the new phase is already current)", () => {
    const { entity, pc, abilities } = setup([
      {
        id: "a",
        phases: {
          one: { timeline: [], duration: 1, on: { go: "two" } },
          two: { timeline: [], duration: 1 },
        },
      },
    ]);
    let observed: string | undefined;
    entity.on(PhaseChanged, ({ activation }) => {
      observed = activation.phase;
    });
    abilities.send("a");
    pc._tick(0.1);
    abilities.send("go");
    expect(observed).toBe("two");
  });

  it("an exit hook that itself forces a replacement leaves it installed and emits its own events — the outer finishLane doesn't orphan it or double-emit", () => {
    const c: AbilityDef = {
      id: "c",
      priority: 50,
      timeline: [beep({ at: 0, id: "c" })],
    };
    const seen: string[] = [];
    const probe = defineStep<object>("probe", {
      exit: (_params, ctx) => {
        ctx.abilities.force(c);
        seen.push("after-force-in-exit");
      },
    });
    const { entity, pc, abilities } = setup([
      { id: "test", timeline: [probe({ from: 0, to: 1 })] },
    ]);
    entity.on(AbilityStarted, ({ activation }) =>
      seen.push(`started:${activation.def.id}`),
    );
    entity.on(AbilityEnded, ({ activation }) =>
      seen.push(`ended:${activation.def.id}`),
    );

    abilities.send("test");
    pc._tick(0.1); // let the window's `enter` fire, so cancel() has something open to close
    seen.length = 0;
    abilities.cancel();

    expect(seen).toEqual(["after-force-in-exit", "ended:test", "started:c"]);
    expect(abilities.activeId()).toBe("c");
    expect(abilities.active()?.state).toBe("active");

    // The replacement isn't just installed — it runs: advance it to its own
    // natural completion and confirm its Ended fires exactly once (not
    // orphaned, not double-finished by the outer finishLane frame).
    const replacement = abilities.active()!;
    seen.length = 0;
    pc._tick(0.01);

    expect(seen).toEqual(["ended:c"]);
    expect(replacement.state).toBe("completed");
    expect(abilities.active()).toBeNull();
  });
});

describe("Abilities — cancelAll re-reads lanes", () => {
  it("a replacement an exit hook installs during cancelAll (via entity destroy) also ends up cancelled, not left dangling", () => {
    const c: AbilityDef = {
      id: "c",
      priority: 50,
      timeline: [beep({ at: 0, id: "c" })],
    };
    let cActivation: AbilityActivation | undefined;
    const forceC = defineStep<object>("forceC", {
      exit: (_params, ctx) => {
        const result = ctx.abilities.force(c);
        cActivation = result.ok ? result.activation : undefined;
      },
    });
    const { entity, scene, pc, abilities } = setup([
      { id: "a", timeline: [forceC({ from: 0, to: 1 })] },
    ]);

    abilities.send("a");
    pc._tick(0.1); // open a's window
    const a = abilities.active()!;

    entity.destroy();
    scene._flushDestroyQueue();

    // The engine drops event delivery for a destroyed entity (`Entity.emit`
    // no-ops once `destroy()` runs), so assert handle state, not listeners.
    expect(a.state).toBe("cancelled");
    expect(cActivation).toBeDefined();
    expect(cActivation!.state).toBe("cancelled"); // picked up by cancelAll's own re-read, not orphaned
    expect(abilities.active()).toBeNull();
  });
});
