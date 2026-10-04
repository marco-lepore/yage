import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary, Logger } from "@yagejs/core";
import { Stats } from "./Stats.js";
import type { StatDependency, StatValue } from "./types.js";

const options = () => ({
  errorBoundary: new ErrorBoundary(new Logger({ output: () => {} })),
});

describe("derived base and effective dependencies", () => {
  it("reads composed base and effective values in one evaluation without repeating the formula", () => {
    const attack = vi.fn(() => 100);
    const model = new Stats<"attack" | "aura" | "total">({
      attack: { derived: { dependencies: [], evaluate: attack } },
      aura: {
        derived: {
          dependencies: [{ stat: "attack", value: "base" }],
          evaluate: (get) => get("attack", "base") * 2,
        },
      },
      total: {
        derived: {
          dependencies: ["attack", { stat: "attack", value: "base" }, "aura"],
          evaluate: (get) =>
            get("attack") + get("attack", "base") + get("aura"),
        },
      },
    });
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 50 },
      { stat: "attack", operation: "basePercent", value: 1 },
    ]);
    expect(model.values()).toEqual({ attack: 300, aura: 300, total: 750 });
    expect(attack).toHaveBeenCalledTimes(1);
    expect(model.explain("aura")).toMatchObject({
      unmodifiedBase: 300,
      base: 300,
      value: 300,
    });
    expect(model.keys).toEqual(["attack", "aura", "total"]);
  });

  it("propagates equipment replacement, base effect expiry, and restore to dependent formulas", () => {
    const create = () =>
      new Stats<"attack" | "aura">({
        attack: { base: 100 },
        aura: {
          derived: {
            dependencies: [{ stat: "attack", value: "base" }],
            evaluate: (get) => get("attack", "base") * 2,
          },
        },
      });
    const model = create();
    model.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 50 },
    ]);
    model.addEffect({
      modifiers: [{ stat: "attack", operation: "baseAdd", value: 20 }],
      duration: 2,
    });
    const restored = create();
    restored.restore(model.snapshot());
    expect(restored.get("aura")).toBe(340);
    restored.advance(2);
    expect(restored.get("aura")).toBe(300);
    restored.setSource("weapon", [
      { stat: "attack", operation: "baseAdd", value: 10 },
    ]);
    expect(restored.get("aura")).toBe(220);
    restored.removeSource("weapon");
    expect(restored.get("aura")).toBe(200);
  });

  it.each(["base", "effective"] as const)(
    "rejects an undeclared %s read even when the other value is declared",
    (value) => {
      const declared = value === "base" ? "effective" : "base";
      const model = new Stats<"attack" | "aura">(
        {
          attack: { base: 100 },
          aura: {
            derived: {
              dependencies: [{ stat: "attack", value: declared }],
              evaluate: (get) => get("attack", value),
            },
          },
        },
        options(),
      );
      expect(() => model.get("aura")).toThrow(
        `undeclared dependency ${value}:attack`,
      );
      expect(model.errorBoundary.getCallbackErrors()[0]?.event).toBe(
        "base:aura",
      );
    },
  );

  it.each([
    ["base", "base"],
    ["base", "effective"],
    ["effective", "base"],
    ["effective", "effective"],
  ] as const)(
    "rejects cycles through %s and %s dependencies before callbacks run",
    (first, second) => {
      const evaluate = vi.fn(() => 0);
      expect(
        () =>
          new Stats<"a" | "b">({
            a: {
              derived: {
                dependencies: [{ stat: "b", value: first }],
                evaluate,
              },
            },
            b: {
              derived: {
                dependencies: [{ stat: "a", value: second }],
                evaluate,
              },
            },
          }),
      ).toThrow("cycle");
      expect(evaluate).not.toHaveBeenCalled();
    },
  );

  it("validates unknown stats and value selectors at construction", () => {
    expect(
      () =>
        new Stats<string>({
          aura: {
            derived: {
              dependencies: [{ stat: "typo", value: "base" }],
              evaluate: () => 0,
            },
          },
        }),
    ).toThrow("base:typo");
    expect(
      () =>
        new Stats({
          aura: {
            derived: {
              dependencies: [{ stat: "aura", value: "typo" as StatValue }],
              evaluate: () => 0,
            },
          },
        }),
    ).toThrow("unknown value typo");
  });

  it("copies dependency selectors and preserves authored keys containing prefixes", () => {
    type Key = "base:attack" | "aura";
    const dependency: { stat: Key; value: StatValue } = {
      stat: "base:attack",
      value: "base",
    };
    const dependencies: StatDependency<Key>[] = [dependency];
    const model = new Stats<Key>({
      "base:attack": { base: 100 },
      aura: {
        derived: {
          dependencies,
          evaluate: (get) => get("base:attack", "base") * 2,
        },
      },
    });
    dependency.value = "effective";
    dependencies.length = 0;
    expect(model.values()).toEqual({ "base:attack": 100, aura: 200 });
  });

  it("reads bases without evaluating unrelated effective-value arithmetic", () => {
    const model = new Stats<"attack" | "aura">(
      {
        attack: { base: 100 },
        aura: {
          derived: {
            dependencies: [{ stat: "attack", value: "base" }],
            evaluate: (get) => get("attack", "base") * 2,
          },
        },
      },
      options(),
    );
    model.setSource("huge", [
      { stat: "attack", operation: "multiply", value: Number.MAX_VALUE },
    ]);
    expect(model.getBase("attack")).toBe(100);
    expect(model.get("aura")).toBe(200);
    expect(() => model.get("attack")).toThrow("finite");
  });

  it("notifies consumers when a model-owned formula input changes", () => {
    const model = new Stats<"attack" | "ratio" | "aura">({
      attack: { base: 100 },
      ratio: { base: 2 },
      aura: {
        derived: {
          dependencies: [{ stat: "attack", value: "base" }, "ratio"],
          evaluate: (get) => get("attack", "base") * get("ratio"),
        },
      },
    });
    const values: number[] = [];
    model.onChange(() => values.push(model.get("aura")));
    model.setBase("ratio", 3);
    expect(values).toEqual([300]);
  });
});
