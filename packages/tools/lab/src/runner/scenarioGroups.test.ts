import { describe, expect, it } from "vitest";
import { defineScenario } from "../grammar/scenario.js";
import type { ScenarioEntry } from "./ScenarioRegistry.js";
import { groupScenarios } from "./scenarioGroups.js";

const entry = (title: string): ScenarioEntry => ({
  id: title.toLowerCase().replace(/\W+/g, "-"),
  path: `/src/${title}.scenario.ts`,
  title,
  scenario: defineScenario({ title, setup: () => {} }),
  hasDrive: false,
});

/** `[group, ...labels]` per group, so a case reads as the list the panel draws. */
const shape = (titles: readonly string[]): string[][] =>
  groupScenarios(titles.map(entry)).map((group) => [
    group.name ?? "(none)",
    ...group.entries.map((item) => item.label),
  ]);

describe("groupScenarios", () => {
  it("buckets by the part before the first slash and drops it from the label", () => {
    expect(
      shape(["Combat / Slime takes a hit", "Combat / Parry", "Enemies / Bat"]),
    ).toEqual([
      ["Combat", "Slime takes a hit", "Parry"],
      ["Enemies", "Bat"],
    ]);
  });

  it("splits at the first slash only", () => {
    expect(shape(["Combat / Ranged / Bow"])).toEqual([
      ["Combat", "Ranged / Bow"],
    ]);
  });

  it("leaves a title with no slash ungrouped and whole", () => {
    expect(shape(["Sandbox"])).toEqual([["(none)", "Sandbox"]]);
  });

  it("puts ungrouped entries first, then groups in first-seen order", () => {
    expect(shape(["Zeta / One", "Loose", "Alpha / Two"])).toEqual([
      ["(none)", "Loose"],
      ["Zeta", "One"],
      ["Alpha", "Two"],
    ]);
  });

  it("treats an empty half as no group at all", () => {
    expect(shape(["/ Orphan", "Trailing /"])).toEqual([
      ["(none)", "/ Orphan", "Trailing /"],
    ]);
  });

  it("returns nothing for no scenarios", () => {
    expect(groupScenarios([])).toEqual([]);
  });
});
