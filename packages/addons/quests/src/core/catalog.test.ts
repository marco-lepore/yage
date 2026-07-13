import { describe, expect, it } from "vitest";
import { defineQuests } from "./catalog.js";

describe("defineQuests", () => {
  it("derives quest ids from map keys and objective ids from the nested map, preserving authoring order", () => {
    const catalog = defineQuests({
      gatherHerbs: {
        title: "Gather Herbs",
        objectives: {
          herb: { title: "Collect red herbs", count: 5 },
          turnIn: { title: "Return to the healer" },
        },
      },
      thinThePack: {
        title: "Thin the Pack",
        objectives: { wolf: { title: "Slay wolves", count: 3 } },
      },
    });
    expect(catalog.ids).toEqual(["gatherHerbs", "thinThePack"]);
    expect(catalog.objectiveIds("gatherHerbs")).toEqual(["herb", "turnIn"]);
    expect(catalog.get("gatherHerbs").id).toBe("gatherHerbs");
  });

  it("defaults an objective's count to 1 when omitted", () => {
    const catalog = defineQuests({
      q: { title: "Q", objectives: { step: { title: "Step" } } },
    });
    expect(catalog.get("q").objectives.get("step")?.count).toBe(1);
  });

  it("defaults autoComplete to true and preserves false", () => {
    const catalog = defineQuests({
      automatic: { title: "Automatic", objectives: { step: {} } },
      manual: { title: "Manual", autoComplete: false, objectives: { step: {} } },
    });
    expect(catalog.get("automatic").autoComplete).toBe(true);
    expect(catalog.get("manual").autoComplete).toBe(false);
  });

  it("freezes quest defs", () => {
    const catalog = defineQuests({ q: { title: "Q", objectives: { a: {} } } });
    expect(Object.isFrozen(catalog.get("q"))).toBe(true);
    expect(Object.isFrozen(catalog.get("q").objectives.get("a"))).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(() => defineQuests({ q: { title: "", objectives: {} } })).toThrow(/title is required/);
  });

  it("rejects a non-integer or < 1 objective count", () => {
    expect(() =>
      defineQuests({ q: { title: "Q", objectives: { a: { count: 0 } } } }),
    ).toThrow(/count must be an integer/);
    expect(() =>
      defineQuests({ q: { title: "Q", objectives: { a: { count: 1.5 } } } }),
    ).toThrow(/count must be an integer/);
  });

  it("rejects a requires id naming a quest absent from the whole map", () => {
    expect(() =>
      defineQuests({
        q: { title: "Q", objectives: { step: {} }, requires: ["nope"] },
      }),
    ).toThrow(/requires unknown quest/);
  });

  it("allows a requires forward reference to a later-declared quest", () => {
    expect(() =>
      defineQuests({
        first: { title: "First", objectives: { step: {} }, requires: ["second"] },
        second: { title: "Second", objectives: { step: {} } },
      }),
    ).not.toThrow();
  });

  it("rejects a quest with no objectives", () => {
    expect(() => defineQuests({ q: { title: "Q", objectives: {} } })).toThrow(
      /must declare at least one non-optional objective/,
    );
  });

  it("rejects a quest whose objectives are all optional", () => {
    expect(() =>
      defineQuests({
        q: { title: "Q", objectives: { bonus: { optional: true } } },
      }),
    ).toThrow(/must declare at least one non-optional objective/);
  });

  it("allows a mix of optional and non-optional objectives", () => {
    expect(() =>
      defineQuests({
        q: {
          title: "Q",
          objectives: { required: {}, bonus: { optional: true } },
        },
      }),
    ).not.toThrow();
  });

  it("get throws on unknown ids; tryGet returns undefined; has narrows", () => {
    const catalog = defineQuests({ q: { title: "Q", objectives: { step: {} } } });
    expect(() => catalog.get("nope" as never)).toThrow(/unknown quest id/);
    expect(catalog.tryGet("nope")).toBeUndefined();
    expect(catalog.has("nope")).toBe(false);
    expect(catalog.has("q")).toBe(true);
  });
});
