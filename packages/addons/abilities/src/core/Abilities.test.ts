import { describe, expect, it } from "vitest";
import {
  createMockEntity,
  KeyframeAnimator,
  ProcessComponent,
} from "@yagejs/core";
import { Abilities, AbilityEnded, AbilityStarted } from "./Abilities.js";
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

describe("Abilities — timeline playback", () => {
  it("points fire at their time, not before", () => {
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [beep({ at: 0.2, id: "a" }), beep({ at: 0.4, id: "b" })],
      },
    ]);
    abilities.play("test");
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
    abilities.play("test");
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
    abilities.play("test");
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
    abilities.play("test");
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
    abilities.play("test");
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
    abilities.play("test");
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

    abilities.play("test");
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
    abilities.play("test");
    pc._tick(0.2);
    expect(log).toEqual(["enter:z"]);
    entity.destroy();
    scene._flushDestroyQueue();
    expect(log).toEqual(["enter:z", "exit:z:true"]);
  });
});

describe("Abilities — activation gating", () => {
  it("play() is refused as busy while active, succeeds again once idle", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.2, id: "a" })] },
    ]);
    expect(abilities.play("test")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    expect(abilities.play("test")).toEqual({ ok: false, reason: "busy" });
    pc._tick(0.2);
    expect(abilities.isActive()).toBe(false);
  });

  it("play() is refused as cooldown during cooldown, succeeds again once it elapses", () => {
    const { pc, abilities } = setup([
      { id: "test", cooldown: 0.3, timeline: [beep({ at: 0.2, id: "a" })] },
    ]);
    expect(abilities.play("test")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    pc._tick(0.2); // ability completes; cooldown (started at play time) at 0.2/0.3
    expect(abilities.isActive()).toBe(false);
    expect(abilities.play("test")).toEqual({ ok: false, reason: "cooldown" });
    pc._tick(0.1); // cooldown reaches 0.3
    expect(abilities.play("test")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
  });

  it("throws for an unknown ability id", () => {
    const { abilities } = setup([
      { id: "known", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    expect(() => abilities.play("nope")).toThrow(/unknown ability id "nope"/);
    expect(() => abilities.cooldownRemaining("nope")).toThrow(
      /unknown ability id "nope"/,
    );
  });

  it("elapsed is null when idle and advances while active", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.2, id: "a" })] },
    ]);
    expect(abilities.elapsed()).toBeNull();
    abilities.play("test");
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
    abilities.play("test");
    pc._tick(0.25);
    expect(abilities.cooldownRemaining("test")).toBeCloseTo(0.15);
    expect(abilities.cooldownRatio("test")).toBeCloseTo(0.625);
    pc._tick(0.15);
    expect(abilities.cooldownRemaining("test")).toBe(0);
    expect(abilities.cooldownRatio("test")).toBe(1);
  });
});

describe("Abilities — construction validation", () => {
  it("throws on duplicate ability ids", () => {
    const def: AbilityDef = { id: "a", timeline: [] };
    expect(() => new Abilities([def, { ...def }])).toThrow(
      /duplicate ability id "a"/,
    );
  });

  it("throws when the same step object appears twice in one timeline", () => {
    const shared = beep({ at: 0.1, id: "a" });
    expect(
      () => new Abilities([{ id: "a", timeline: [shared, shared] }]),
    ).toThrow(
      /step "beep" \(step #1\) is the same step object as an earlier timeline entry/,
    );
  });

  it("throws when a window's to <= from", () => {
    expect(
      () =>
        new Abilities([
          { id: "a", timeline: [zone({ from: 0.5, to: 0.5, id: "z" })] },
        ]),
    ).toThrow(/to=0\.5 <= from=0\.5/);
  });

  it("throws on a negative point `at`", () => {
    expect(
      () =>
        new Abilities([{ id: "a", timeline: [beep({ at: -0.1, id: "a" })] }]),
    ).toThrow(/at=-0\.1 < 0/);
  });

  it("throws on a negative window `from`", () => {
    expect(
      () =>
        new Abilities([
          { id: "a", timeline: [zone({ from: -0.1, to: 0.2, id: "z" })] },
        ]),
    ).toThrow(/from=-0\.1 < 0/);
  });

  it("throws when every <= 0", () => {
    expect(
      () =>
        new Abilities([
          { id: "a", timeline: [zone({ from: 0, to: 1, every: 0, id: "z" })] },
        ]),
    ).toThrow(/every=0 <= 0/);
  });

  it("throws when a step ends past an explicit duration", () => {
    expect(
      () =>
        new Abilities([
          { id: "a", duration: 0.5, timeline: [beep({ at: 0.6, id: "a" })] },
        ]),
    ).toThrow(/ending at 0\.6, past its explicit duration 0\.5/);
  });

  it("names the offending step's timeline index when a def has several steps", () => {
    expect(
      () =>
        new Abilities([
          {
            id: "a",
            timeline: [
              beep({ at: 0, id: "a" }),
              zone({ from: 0.5, to: 0.5, id: "z" }),
            ],
          },
        ]),
    ).toThrow(/step "zone" \(step #1\) has to=0\.5 <= from=0\.5/);
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
    abilities.play("test");
    pc._tick(0.5);
    expect(abilities.isActive()).toBe(false); // completed exactly at the last step end
    expect(log).toEqual(["enter:z", "fire:a", "exit:z:false"]);
  });
});

describe("Abilities — cancel from inside a hook", () => {
  it("makes the remaining due events of the same tick inert", () => {
    const stop = defineStep<{ id: string }>("stop", {
      fire: (_params, ctx) => ctx.abilities.cancel(),
    });
    const { pc, abilities, log } = setup([
      {
        id: "test",
        timeline: [
          zone({ from: 0, to: 0.3, id: "z" }),
          stop({ at: 0.1, id: "s" }),
          beep({ at: 0.2, id: "late" }),
        ],
      },
    ]);
    abilities.play("test");
    pc._tick(0.05); // zone is open
    pc._tick(0.2); // one tick spanning both the cancelling step and the later point
    expect(log).toEqual(["enter:z", "exit:z:true"]);
    expect(abilities.isActive()).toBe(false);
  });
});

describe("Abilities — activation rule (lanes + priority)", () => {
  it("a play() at equal priority to the active def is refused", () => {
    const { abilities } = setup([
      { id: "a", timeline: [beep({ at: 0.5, id: "a" })] },
      { id: "b", timeline: [beep({ at: 0.5, id: "b" })] },
    ]);
    expect(abilities.play("a")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    expect(abilities.play("b")).toEqual({ ok: false, reason: "busy" });
    expect(abilities.activeId()).toBe("a");
  });

  it("a higher-priority play() interrupts the active def, closing its windows as cancelled", () => {
    const { pc, abilities, log } = setup([
      { id: "a", timeline: [zone({ from: 0, to: 1, id: "z" })] },
      { id: "b", priority: 10, timeline: [beep({ at: 0, id: "b" })] },
    ]);
    abilities.play("a");
    pc._tick(0.1);
    expect(log).toEqual(["enter:z"]);
    expect(abilities.play("b")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
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
    expect(abilities.force(reactionDef)).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    expect(log).toEqual(["enter:z", "exit:z:true"]); // restart hasn't ticked yet
    pc._tick(0.01);
    expect(log).toEqual(["enter:z", "exit:z:true", "enter:z"]);
  });

  it("a lower-priority force() is refused as busy (super-armor)", () => {
    const { abilities } = setup([
      { id: "a", priority: 100, timeline: [beep({ at: 0.5, id: "a" })] },
    ]);
    abilities.play("a");
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
    abilities.play("a");
    const strong: AbilityDef = {
      id: "strong",
      priority: 100,
      timeline: [beep({ at: 0, id: "s" })],
    };
    expect(abilities.force(strong)).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    expect(abilities.activeId()).toBe("strong");
  });

  it("force bypasses cooldown; play remains gated by it", () => {
    const aDef: AbilityDef = {
      id: "a",
      cooldown: 0.5,
      timeline: [beep({ at: 0.1, id: "a" })],
    };
    const { pc, abilities } = setup([aDef]);
    abilities.play("a");
    pc._tick(0.1); // completes; cooldown now running
    expect(abilities.play("a")).toEqual({ ok: false, reason: "cooldown" });
    expect(abilities.force(aDef)).toEqual({
      ok: true,
      activation: expect.any(Object),
    }); // same def, but force ignores cooldown
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
    expect(abilities.play("a")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
    expect(abilities.play("b")).toEqual({
      ok: true,
      activation: expect.any(Object),
    });
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
    abilities.play("a");
    abilities.play("b");
    pc._tick(0.2);
    expect(abilities.activeId("main")).toBe("a");
    expect(abilities.activeId("side")).toBe("b");
    expect(abilities.elapsed("main")).toBeCloseTo(0.2);

    abilities.cancel("main");
    expect(abilities.isActive("main")).toBe(false);
    expect(abilities.isActive("side")).toBe(true); // untouched
    expect(abilities.activeId("side")).toBe("b");
  });

  it('omitting the lane argument defaults to "main"', () => {
    const { abilities } = setup([
      { id: "a", timeline: [beep({ at: 1, id: "a" })] },
    ]);
    abilities.play("a");
    expect(abilities.isActive()).toBe(true);
    expect(abilities.isActive("main")).toBe(true);
    expect(abilities.activeId()).toBe("a");
    abilities.cancel();
    expect(abilities.isActive("main")).toBe(false);
  });
});

describe("Abilities — mid-tick interruption from inside the ability's own hook", () => {
  it("silences the rest of that tick's due events on the interrupted activation", () => {
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
    abilities.play("a");
    pc._tick(0.2); // one tick spans both the interrupt at 0.1 and the late point at 0.15
    expect(entries.slice(0, 3)).toEqual([
      "enter:z",
      "interrupt",
      "exit:z:true",
    ]);
    expect(entries).not.toContain("fire:late");
    expect(abilities.activeId()).toBe("reaction");
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

    const result = abilities.play("test");
    if (!result.ok) throw new Error("expected play to succeed");
    pc._tick(0.05);

    expect(ctxActivation).toBe(result.activation);
    expect(started[0]).toBe(result.activation);
    expect(abilities.active()).toBe(result.activation);

    pc._tick(0.2);
    expect(ended[0]).toBe(result.activation);
    expect(abilities.active()).toBeNull();
  });

  it("PlayResult.activation carries the new run's def and lane", () => {
    const { abilities } = setup([
      { id: "test", lane: "side", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    const result = abilities.play("test");
    if (!result.ok) throw new Error("expected play to succeed");
    expect(result.activation.def.id).toBe("test");
    expect(result.activation.lane).toBe("side");
    expect(result.activation.forced).toBe(false);
    expect(result.activation.state).toBe("active");
  });

  it("active().duration is the resolved value even when AbilityDef.duration is omitted", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [zone({ from: 0, to: 0.5, id: "z" })] },
    ]);
    abilities.play("test");
    pc._tick(0.1);
    expect(abilities.active()?.duration).toBeCloseTo(0.5);
  });

  it("active().elapsed clamps to duration even when a tick overshoots it", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [beep({ at: 0.1, id: "a" })] },
    ]);
    abilities.play("test");
    const activation = abilities.active()!;
    pc._tick(1); // massively overshoots the ~0.1s duration in one tick
    expect(activation.elapsed).toBeCloseTo(0.1);
    expect(activation.state).toBe("completed");
  });

  it("cancel flips state to cancelled and freezes elapsed at the moment of cancel", () => {
    const { pc, abilities } = setup([
      { id: "test", timeline: [zone({ from: 0, to: 1, id: "z" })] },
    ]);
    abilities.play("test");
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
    abilities.play("test");
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

    abilities.play("test");
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

    abilities.play("test");
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

    abilities.play("a");
    events.length = 0; // drop the initial "started:a" noise
    const result = abilities.play("b");
    if (!result.ok) throw new Error("expected play to succeed");

    expect(events).toEqual(["ended:a", "started:b"]);
    // Identity, not just the id string: the exact same handle `play("b")`
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

    abilities.play("a");
    events.length = 0;
    abilities.play("b");

    expect(events).toEqual(["ended:a", "started:b", "ended:b", "started:c"]);
  });

  it("a listener that reacts to Ended by playing another ability sees causal FIFO order, not a synchronous inversion", () => {
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
    entity.on(AbilityStarted, ({ activation }) =>
      events.push(`started:${activation.def.id}`),
    );
    entity.on(AbilityEnded, ({ activation }) => {
      events.push(`ended:${activation.def.id}`);
      if (activation.def.id === "a") abilities.force(c);
    });

    abilities.play("a");
    events.length = 0;
    abilities.play("b");

    // Ended(a) fires during the drain (b is already installed by the time it
    // delivers), so forcing c from that handler interrupts b, not a — same
    // causal shape as the Started-triggered cascade above, reached from a
    // different listener.
    expect(events).toEqual(["ended:a", "started:b", "ended:b", "started:c"]);
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

    abilities.play("test");
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

describe("Abilities — re-contesting the lane against a mid-cancel replacement", () => {
  it("play() loops the activation rule: A -> C (installed by A's own exit hook) -> B, each losing occupant ends exactly once", () => {
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

    abilities.play("a");
    pc._tick(0.1); // open a's window, so cancelling it below runs the exit hook
    events.length = 0;
    const result = abilities.play("b");
    if (!result.ok) throw new Error("expected play to succeed");

    // b's activate() call cancels a; a's own exit hook installs c
    // (out-competing a); b's loop then re-contests against c (the real
    // current occupant) instead of blindly overwriting it, and wins.
    expect(events).toEqual(["ended:a", "started:c", "ended:c", "started:b"]);
    expect(abilities.active()).toBe(result.activation);
  });

  it("a refusal reached against the replacement is still a refusal — the first occupant stays gone, the replacement stays installed and later completes normally", () => {
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

    abilities.play("a");
    pc._tick(0.1);
    events.length = 0;
    const result = abilities.play("b"); // b (priority 10) loses to c (priority 50), not a

    expect(result).toEqual({ ok: false, reason: "busy" });
    expect(events).toEqual(["ended:a", "started:c"]); // a's cancellation ran; b never touched c
    expect(abilities.activeId()).toBe("c");

    events.length = 0;
    pc._tick(0.01); // c keeps running, untouched by the refusal, and completes on its own
    expect(events).toEqual(["ended:c"]);
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

    abilities.play("a");
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
