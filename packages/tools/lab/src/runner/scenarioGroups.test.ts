import { describe, expect, it } from "vitest";
import { defineScenario } from "../grammar/scenario.js";
import { buildRegistry, type ScenarioEntry } from "./ScenarioRegistry.js";
import { buildScenarioTree, type ScenarioNode } from "./scenarioGroups.js";

/** The registry decides placement, so the tree is checked against real entries. */
function entries(paths: Record<string, string[]>): readonly ScenarioEntry[] {
  const modules: Record<string, unknown> = {};
  for (const [path, exportNames] of Object.entries(paths)) {
    modules[`/src/lab/${path}.scenario.ts`] = Object.fromEntries(
      exportNames.map((name) => [name, defineScenario({ setup: () => {} })]),
    );
  }
  return buildRegistry(modules, { root: "/src/lab" }).scenarios;
}

/** Indented lines, so a case reads as the list the panel draws. */
function draw(nodes: readonly ScenarioNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === "group"
      ? [
          `${"  ".repeat(depth)}${node.name}/`,
          ...draw(node.children, depth + 1),
        ]
      : [`${"  ".repeat(depth)}${node.label}`],
  );
}

describe("buildScenarioTree", () => {
  it("nests a directory per level and puts the file's scenarios under it", () => {
    const tree = buildScenarioTree(
      entries({ "enemies/slime": ["chase", "idle"] }),
    );

    expect(draw(tree)).toEqual([
      "enemies/",
      "  slime/",
      "    chase",
      "    idle",
    ]);
  });

  it("shares a group between the files under it", () => {
    const tree = buildScenarioTree(
      entries({ "enemies/slime": ["idle"], "enemies/bat": ["swoop"] }),
    );

    expect(draw(tree)).toEqual([
      "enemies/",
      "  bat/",
      "    swoop",
      "  slime/",
      "    idle",
    ]);
  });

  it("keeps same-named groups under different parents apart", () => {
    const tree = buildScenarioTree(
      entries({ "enemies/ai/chase": ["a"], "player/ai/aim": ["b"] }),
    );

    expect(draw(tree)).toEqual([
      "enemies/",
      "  ai/",
      "    chase/",
      "      a",
      "player/",
      "  ai/",
      "    aim/",
      "      b",
    ]);
  });

  it("puts a file's only scenario beside the folders, not inside one", () => {
    const tree = buildScenarioTree(
      entries({ "enemies/slime": ["default"], "enemies/bat": ["swoop"] }),
    );

    expect(draw(tree)).toEqual(["enemies/", "  bat/", "    swoop", "  slime"]);
  });

  it("leaves a scenario at the top when nothing groups it", () => {
    const tree = buildScenarioTree(entries({ sandbox: ["default"] }));

    expect(draw(tree)).toEqual(["sandbox"]);
  });

  it("nests by an explicit title when a scenario carries one", () => {
    const registry = buildRegistry(
      {
        "/src/lab/enemies/slime.scenario.ts": {
          king: defineScenario({
            title: "Bosses / Act 1 / Slime King",
            setup: () => {},
          }),
        },
      },
      { root: "/src/lab" },
    );

    expect(draw(buildScenarioTree(registry.scenarios))).toEqual([
      "Bosses/",
      "  Act 1/",
      "    Slime King",
    ]);
  });

  it("returns nothing for no scenarios", () => {
    expect(buildScenarioTree([])).toEqual([]);
  });
});
