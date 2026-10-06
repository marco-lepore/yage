import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary, Logger } from "@yagejs/core";
import { Stats } from "./Stats.js";
import type { StatModifier } from "./types.js";

const modifier = (value: number): StatModifier<"attack"> => ({
  stat: "attack",
  operation: "flat",
  value,
});
const errorBoundary = () => new ErrorBoundary(new Logger({ output: () => {} }));
const stats = () =>
  new Stats({ attack: { base: 100 } }, { errorBoundary: errorBoundary() });

describe("Stats math and sources", () => {
  it("owns equipment base contributions and traits together without changing the stored base", () => {
    const model = stats();
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 50 },
      { stat: "attack", operation: "basePercent", value: 0.2 },
      modifier(20),
    ]);
    expect(model.getBase("attack")).toBe(150);
    expect(model.get("attack")).toBe(200);
    expect(model.explain("attack")).toMatchObject({
      unmodifiedBase: 100,
      baseAdd: 50,
      base: 150,
      flat: 20,
    });
    expect(model.snapshot().bases.attack).toBe(100);
    model.setBase("attack", 120);
    expect(model.getBase("attack")).toBe(170);
    expect(model.get("attack")).toBe(224);
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 30 },
    ]);
    expect(model.get("attack")).toBe(150);
    model.removeSource("weapon");
    expect(model.getBase("attack")).toBe(120);
    expect(model.get("attack")).toBe(120);
  });

  it("sums base contributions before percentage and multiplicative modifiers regardless of source order", () => {
    for (const reverse of [false, true]) {
      const model = stats();
      const sources: [string, StatModifier<"attack">[]][] = [
        [
          "traits",
          [
            modifier(10),
            { stat: "attack", operation: "basePercent", value: 0.5 },
            { stat: "attack", operation: "percent", value: 0.25 },
            { stat: "attack", operation: "multiply", value: 2 },
          ],
        ],
        ["weapon", [{ stat: "attack", operation: "baseAdd", value: 50 }]],
        ["curse", [{ stat: "attack", operation: "baseAdd", value: -10 }]],
      ];
      for (const [source, modifiers] of reverse ? sources.reverse() : sources) {
        model.setSource(source, modifiers);
      }
      expect(model.getBase("attack")).toBe(140);
      expect(model.get("attack")).toBe(550);
    }
  });

  it("adds to a derived base and propagates the effective value to dependent stats", () => {
    const model = new Stats<"strength" | "attack" | "damage">({
      strength: { base: 10 },
      attack: {
        derived: {
          dependencies: ["strength"],
          evaluate: (get) => get("strength") * 2,
        },
      },
      damage: {
        derived: {
          dependencies: ["attack"],
          evaluate: (get) => get("attack") * 3,
        },
      },
    });
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 30 },
      { stat: "attack", operation: "basePercent", value: 0.5 },
    ]);
    expect(model.getBase("attack")).toBe(50);
    expect(model.get("damage")).toBe(225);
    model.setBase("strength", 20);
    expect(model.explain("attack")).toMatchObject({
      unmodifiedBase: 40,
      baseAdd: 30,
      base: 70,
    });
    expect(model.get("damage")).toBe(315);
    model.removeSource("weapon");
    expect(model.get("damage")).toBe(120);
  });

  it("keeps base contributions separate from final overrides and bounds", () => {
    const model = new Stats({ attack: { base: 100, max: 120 } });
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 50 },
    ]);
    expect(model.getBase("attack")).toBe(150);
    expect(model.get("attack")).toBe(120);
    model.setSource("override", [
      { stat: "attack", operation: "override", value: 10 },
    ]);
    expect(model.getBase("attack")).toBe(150);
    expect(model.get("attack")).toBe(10);
  });

  it("rejects non-finite base contributions and reports composed-base overflow", () => {
    const model = stats();
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 50 },
    ]);
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() =>
        model.setSource("weapon", [
          { stat: "attack", operation: "baseAdd", value },
        ]),
      ).toThrow("finite");
      expect(model.getBase("attack")).toBe(150);
    }
    model.setBase("attack", Number.MAX_VALUE);
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: Number.MAX_VALUE },
    ]);
    expect(() => model.get("attack")).toThrow("Stats.getBase(attack)");
  });

  it("separates base percentages, flat additions, summed percentages, and independent factors", () => {
    const model = stats();
    model.setSource("equipment", [
      { stat: "attack", operation: "basePercent", value: 0.5 },
      modifier(20),
      { stat: "attack", operation: "percent", value: 0.2 },
      { stat: "attack", operation: "percent", value: 0.3 },
      { stat: "attack", operation: "multiply", value: 2 },
      { stat: "attack", operation: "multiply", value: 1.5 },
    ]);
    expect(model.get("attack")).toBe(765);
    expect(model.explain("attack")).toMatchObject({
      base: 100,
      flat: 20,
      basePercent: 0.5,
      percent: 0.5,
      multiplier: 3,
    });
  });

  it("replaces equipment without accumulation, copies inputs, and removes one owner", () => {
    const model = stats();
    const mods = [modifier(10)];
    model.setSource("weapon", mods);
    mods[0] = modifier(999);
    expect(model.get("attack")).toBe(110);
    model.addEffect({ source: "potion", modifiers: [modifier(30)] });
    model.setSource("weapon", [modifier(20)]);
    expect(model.get("attack")).toBe(150);
    expect(model.removeSource("weapon")).toBe(1);
    expect(model.get("attack")).toBe(130);
    expect(model.removeSource("missing")).toBe(0);
  });

  it("resolves overrides by priority, then recency, before rounding and bounds", () => {
    const model = new Stats({
      attack: { base: 100, min: 5, max: 50, round: "floor" },
    });
    const override = (value: number, priority = 0): StatModifier<"attack"> => ({
      stat: "attack",
      operation: "override",
      value,
      priority,
    });
    model.setSource("a", [override(20.8, 2)]);
    model.setSource("b", [override(80, 1)]);
    expect(model.get("attack")).toBe(20);
    model.setSource("c", [override(40.8, 2)]);
    expect(model.get("attack")).toBe(40);
    model.removeSource("c");
    expect(model.get("attack")).toBe(20);
    model.removeSource("a");
    expect(model.get("attack")).toBe(50);
    model.setSource("b", [override(-30)]);
    expect(model.get("attack")).toBe(5);
  });

  it("recomputes derived dependencies and allows modifiers on derived stats", () => {
    const model = new Stats<"strength" | "attack" | "damage">({
      strength: { base: 10 },
      attack: {
        derived: {
          dependencies: ["strength"],
          evaluate: (get) => get("strength") * 2,
        },
      },
      damage: {
        derived: {
          dependencies: ["attack"],
          evaluate: (get) => get("attack") * 3,
        },
      },
    });
    model.setSource("ring", [
      { stat: "strength", operation: "flat", value: 5 },
      modifier(10),
    ]);
    expect(model.values()).toEqual({ strength: 15, attack: 40, damage: 120 });
    expect(model.getBase("attack")).toBe(30);
    model.setBase("strength", 20);
    expect(model.get("damage")).toBe(180);
    expect(() => model.setBase("attack", 2)).toThrow("derived");
  });

  it("rejects invalid batches without partial writes or equipment removal", () => {
    const model = new Stats({ attack: { base: 100 }, speed: { base: 10 } });
    model.setSource("weapon", [modifier(5)]);
    expect(() => model.setBases({ attack: 2, speed: NaN })).toThrow("speed");
    expect(() => model.setSource("weapon", [modifier(Infinity)])).toThrow(
      "finite",
    );
    expect(model.values()).toEqual({ attack: 105, speed: 10 });
    expect(() =>
      model.setSource("weapon", [
        {
          ...modifier(2),
          stat: "missing",
        } as unknown as StatModifier<"attack">,
      ]),
    ).toThrow("missing");
  });

  it("rejects invalid definitions, cycles, and non-finite callback results", () => {
    expect(() => new Stats({ attack: { base: NaN } })).toThrow("finite");
    expect(() => new Stats({ attack: { min: 5, max: 2 } })).toThrow(
      "min exceeds max",
    );
    expect(
      () =>
        new Stats({
          attack: { base: 1, derived: { dependencies: [], evaluate: () => 2 } },
        }),
    ).toThrow("both base and derived");
    expect(
      () =>
        new Stats({
          attack: { derived: { dependencies: ["attack"], evaluate: () => 2 } },
        }),
    ).toThrow("cycle");
    const model = new Stats(
      { attack: { derived: { dependencies: [], evaluate: () => NaN } } },
      { errorBoundary: errorBoundary() },
    );
    expect(() => model.get("attack")).toThrow("finite");
    expect(model.errorBoundary.getCallbackErrors()[0]?.event).toBe(
      "base:attack",
    );
  });

  it("guards mutation inside formulas and allows later reads after an error", () => {
    let mutate = true;
    const model: Stats<"attack"> = new Stats(
      {
        attack: {
          derived: {
            dependencies: [],
            evaluate: () => {
              if (mutate) model.setSource("bad", [modifier(1)]);
              return 5;
            },
          },
        },
      },
      { errorBoundary: errorBoundary() },
    );
    expect(() => model.get("attack")).toThrow("must not mutate");
    mutate = false;
    expect(model.get("attack")).toBe(5);
    expect(model.snapshot().sources).toHaveLength(0);
  });

  it("reports arithmetic overflow before returning an effective value", () => {
    const model = stats();
    model.setSource("huge", [
      { stat: "attack", operation: "multiply", value: Number.MAX_VALUE },
    ]);
    expect(() => model.get("attack")).toThrow("finite");
  });
});

describe("Stats effect lifetime and stacking", () => {
  it("expires at the boundary, supports refresh and idempotent cancellation", () => {
    const model = stats();
    const effect = model.addEffect({ modifiers: [modifier(20)], duration: 2 })!;
    model.advance(0);
    expect(effect.remaining).toBe(2);
    model.advance(1.5);
    expect(model.get("attack")).toBe(120);
    effect.refresh(3);
    model.advance(3);
    expect(effect.active).toBe(false);
    expect(effect.remaining).toBe(0);
    expect(model.get("attack")).toBe(100);
    expect(effect.cancel()).toBe(false);
    expect(() => effect.refresh(1)).toThrow("inactive");
    const permanent = model.addEffect({ modifiers: [modifier(1)] })!;
    model.advance(1e10);
    expect(permanent.remaining).toBeNull();
    expect(permanent.cancel()).toBe(true);
    expect(permanent.cancel()).toBe(false);
  });

  it("rejects invalid durations and deltas without touching state", () => {
    const model = stats();
    for (const duration of [0, -1, NaN, Infinity]) {
      expect(() =>
        model.addEffect({ modifiers: [modifier(1)], duration }),
      ).toThrow();
    }
    const effect = model.addEffect({ modifiers: [], duration: 5 })!;
    for (const dt of [-1, NaN, Infinity])
      expect(() => model.advance(dt)).toThrow();
    expect(() => effect.refresh(0)).toThrow();
    expect(effect.remaining).toBe(5);
  });

  it("caps stacks with reject or oldest replacement and independent timers", () => {
    for (const overflow of ["reject", "oldest"] as const) {
      const model = new Stats(
        { attack: { base: 100 } },
        { groups: { poison: { mode: "stack", limit: 2, overflow } } },
      );
      const first = model.addEffect({
        group: "poison",
        modifiers: [modifier(-10)],
        duration: 2,
      })!;
      const second = model.addEffect({
        group: "poison",
        modifiers: [modifier(-10)],
        duration: 4,
      })!;
      const third = model.addEffect({
        group: "poison",
        modifiers: [modifier(-20)],
        duration: 6,
      });
      expect(first.active).toBe(overflow === "reject");
      expect(third === null).toBe(overflow === "reject");
      expect(model.get("attack")).toBe(overflow === "reject" ? 80 : 70);
      model.advance(4);
      expect(second.active).toBe(false);
      expect(model.get("attack")).toBe(overflow === "reject" ? 100 : 80);
    }
  });

  it("suppresses whole effects and restores weaker effects when a stronger one expires", () => {
    const model = new Stats(
      { attack: { base: 100 } },
      { groups: { aura: { mode: "highest" } } },
    );
    const weak = model.addEffect({
      group: "aura",
      rank: 1,
      modifiers: [modifier(10)],
      duration: 10,
    })!;
    const strong = model.addEffect({
      group: "aura",
      rank: 2,
      modifiers: [modifier(30)],
      duration: 2,
    })!;
    expect(weak.active).toBe(true);
    expect(weak.contributing).toBe(false);
    expect(model.get("attack")).toBe(130);
    model.advance(2);
    expect(strong.active).toBe(false);
    expect(weak.remaining).toBe(8);
    expect(weak.contributing).toBe(true);
    expect(model.get("attack")).toBe(110);
  });

  it("uses the newest effect for latest groups and rank ties", () => {
    for (const mode of ["highest", "latest"] as const) {
      const model = new Stats(
        { attack: { base: 100 } },
        { groups: { aura: { mode } } },
      );
      const first = model.addEffect({
        group: "aura",
        modifiers: [modifier(10)],
      })!;
      const second = model.addEffect({
        group: "aura",
        modifiers: [modifier(20)],
      })!;
      expect(model.get("attack")).toBe(120);
      second.cancel();
      expect(first.contributing).toBe(true);
      expect(model.get("attack")).toBe(110);
    }
  });

  it("does not revive a suppressed effect that expired while suppressed", () => {
    const model = new Stats(
      { attack: { base: 100 } },
      { groups: { aura: { mode: "latest" } } },
    );
    const old = model.addEffect({
      group: "aura",
      modifiers: [modifier(10)],
      duration: 1,
    })!;
    const current = model.addEffect({
      group: "aura",
      modifiers: [modifier(20)],
      duration: 2,
    })!;
    model.advance(1);
    current.cancel();
    expect(old.active).toBe(false);
    expect(model.get("attack")).toBe(100);
  });

  it("removes all effects for an owner, including suppressed effects", () => {
    const model = stats();
    const first = model.addEffect({
      source: "enemy",
      modifiers: [modifier(-10)],
    })!;
    const second = model.addEffect({
      source: "enemy",
      modifiers: [modifier(-20)],
    })!;
    expect(model.removeSource("enemy")).toBe(2);
    expect(first.active || second.active).toBe(false);
    expect(model.get("attack")).toBe(100);
  });

  it("validates group references and stack limits", () => {
    expect(
      () =>
        new Stats(
          { attack: {} },
          { groups: { bad: { mode: "stack", limit: 0 } } },
        ),
    ).toThrow("limit");
    expect(() => stats().addEffect({ group: "typo", modifiers: [] })).toThrow(
      "typo",
    );
  });
});

describe("Stats persistence and notifications", () => {
  it("restores base contributions with suppression and expiry without counting them twice", () => {
    const create = () =>
      new Stats(
        { attack: { base: 100 } },
        { groups: { aura: { mode: "highest" } } },
      );
    const model = create();
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 50 },
      { stat: "attack", operation: "basePercent", value: 0.2 },
    ]);
    model.addEffect({
      group: "aura",
      rank: 1,
      modifiers: [{ stat: "attack", operation: "baseAdd", value: 10 }],
    });
    model.addEffect({
      group: "aura",
      rank: 2,
      duration: 2,
      modifiers: [{ stat: "attack", operation: "baseAdd", value: 30 }],
    });
    model.advance(1);
    const restored = create();
    restored.restore(JSON.parse(JSON.stringify(model.snapshot())) as unknown);
    expect(restored.getBase("attack")).toBe(180);
    expect(restored.get("attack")).toBe(216);
    restored.advance(1);
    expect(restored.getBase("attack")).toBe(160);
    expect(restored.get("attack")).toBe(192);
    restored.removeSource("weapon");
    expect(restored.get("attack")).toBe(110);
    expect(restored.snapshot().bases.attack).toBe(100);
  });

  it("round-trips bases, owners, timers, suppression and ordering through JSON", () => {
    const create = () =>
      new Stats(
        { attack: { base: 100 } },
        { groups: { aura: { mode: "highest" } } },
      );
    const model = create();
    model.setBase("attack", 200);
    model.setSource("sword", [modifier(10)]);
    model.addEffect({
      source: "ally",
      group: "aura",
      rank: 1,
      modifiers: [modifier(20)],
      duration: 8,
    });
    const strong = model.addEffect({
      group: "aura",
      rank: 2,
      modifiers: [modifier(40)],
      duration: 4,
    })!;
    model.advance(1);
    const saved: unknown = JSON.parse(JSON.stringify(model.snapshot()));
    const restored = create();
    restored.restore(saved);
    expect(restored.snapshot()).toEqual(model.snapshot());
    expect(restored.get("attack")).toBe(250);
    expect(restored.effect(strong.id)?.remaining).toBe(3);
    restored.advance(3);
    expect(restored.get("attack")).toBe(230);
    expect(restored.removeSource("ally")).toBe(1);
    expect(restored.get("attack")).toBe(210);
  });

  it("preserves the id sequence after all old effects have expired", () => {
    const model = stats();
    const expired = model.addEffect({ modifiers: [], duration: 1 })!;
    model.advance(1);
    const restored = stats();
    restored.restore(model.snapshot());
    const fresh = restored.addEffect({ modifiers: [] })!;
    expect(fresh.id).toBeGreaterThan(expired.id);
    expect(restored.effect(expired.id)).toBeUndefined();
    expect(() =>
      restored.restore({ ...restored.snapshot(), nextId: fresh.id }),
    ).toThrow("nextId");
    expect(fresh.active).toBe(true);
  });

  it("rejects saves exceeding stack limits and preserves override ordering", () => {
    const model = new Stats(
      { attack: { base: 100 } },
      { groups: { potion: { mode: "stack", limit: 1 } } },
    );
    model.setSource("a", [
      { stat: "attack", operation: "override", value: 20 },
    ]);
    model.setSource("b", [
      { stat: "attack", operation: "override", value: 30 },
    ]);
    const snapshot = model.snapshot();
    model.restore({ ...snapshot, sources: [...snapshot.sources].reverse() });
    expect(model.get("attack")).toBe(30);
    expect(() =>
      model.restore({
        ...snapshot,
        sources: snapshot.sources.map((entry) => ({
          ...entry,
          group: "potion",
        })),
      }),
    ).toThrow("exceeds its limit");
    expect(model.get("attack")).toBe(30);
  });

  it("invalidates old handles on restore even if ids match", () => {
    const model = stats();
    const old = model.addEffect({ modifiers: [modifier(20)], duration: 5 })!;
    model.restore(model.snapshot());
    expect(old.active).toBe(false);
    expect(old.cancel()).toBe(false);
    expect(model.get("attack")).toBe(120);
    expect(model.effect(old.id)?.cancel()).toBe(true);
  });

  it("validates malformed saves completely before mutation", () => {
    const model = stats();
    model.addEffect({ modifiers: [modifier(5)], duration: 2 });
    const snapshot = model.snapshot();
    for (const bad of [
      null,
      { ...snapshot, version: 2 },
      { ...snapshot, bases: {} },
      { ...snapshot, sources: [{ ...snapshot.sources[0], remaining: -1 }] },
      { ...snapshot, sources: [{ ...snapshot.sources[0], group: "unknown" }] },
      { ...snapshot, sources: [...snapshot.sources, ...snapshot.sources] },
      { ...snapshot, bases: { attack: Infinity } },
    ]) {
      expect(() => model.restore(bad)).toThrow();
      expect(model.snapshot()).toEqual(snapshot);
    }
  });

  it("returns detached snapshots and explanations", () => {
    const model = stats();
    model.setSource("sword", [modifier(5)]);
    const saved = model.snapshot();
    saved.bases.attack = 999;
    const mods = model.explain("attack")
      .modifiers as unknown as StatModifier<"attack">[];
    mods[0] = modifier(1000);
    expect(model.get("attack")).toBe(105);
  });

  it("notifies after mutations and expiry, and stops on the first throwing listener", () => {
    const model = stats();
    const values: number[] = [];
    const unsub = model.onChange(() => values.push(model.get("attack")));
    model.addEffect({ modifiers: [modifier(5)], duration: 2 });
    model.advance(1);
    model.advance(1);
    expect(values).toEqual([105, 100]);
    unsub();
    model.onChange(() => {
      throw new Error("listener failed");
    });
    const later = vi.fn();
    model.onChange(later);
    expect(() => model.setBase("attack", 3)).toThrow("listener failed");
    expect(model.get("attack")).toBe(3);
    expect(later).not.toHaveBeenCalled();
    expect(model.errorBoundary.getCallbackErrors()[0]?.kind).toBe(
      "Stats change listener",
    );
  });
});
