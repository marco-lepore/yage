import { describe, expect, it } from "vitest";
import { buildRegistry, scenarioIdFromPath } from "./ScenarioRegistry.js";
import { defineScenario } from "../grammar/scenario.js";

const scenario = (title: string) =>
  ({ default: defineScenario({ title, setup: () => {} }) });

describe("scenarioIdFromPath", () => {
  it("keeps the directory, so same-named files stay distinct", () => {
    expect(scenarioIdFromPath("/src/player/jump.scenario.ts")).toBe(
      "src/player/jump",
    );
    expect(scenarioIdFromPath("/src/enemy/jump.scenario.ts")).toBe(
      "src/enemy/jump",
    );
  });

  it("strips the glob root", () => {
    expect(
      scenarioIdFromPath("/src/lab/enemies/slime.scenario.ts", "/src/lab"),
    ).toBe("enemies/slime");
    expect(
      scenarioIdFromPath("/src/lab/enemies/slime.scenario.ts", "src/lab/"),
    ).toBe("enemies/slime");
  });

  it("leaves a path that is not under the root alone", () => {
    expect(scenarioIdFromPath("/other/slime.scenario.ts", "/src/lab")).toBe(
      "other/slime",
    );
  });

  it("does not strip a root that only matches part of a directory name", () => {
    expect(scenarioIdFromPath("/src/labyrinth/a.scenario.ts", "/src/lab")).toBe(
      "src/labyrinth/a",
    );
  });

  it("accepts the other scenario file extensions and windows separators", () => {
    expect(scenarioIdFromPath("/src/a.scenario.tsx")).toBe("src/a");
    expect(scenarioIdFromPath("/src/a.scenario.js")).toBe("src/a");
    expect(scenarioIdFromPath("src\\lab\\a.scenario.ts", "src/lab")).toBe("a");
  });
});

describe("buildRegistry", () => {
  it("sorts by title and finds by id", () => {
    const registry = buildRegistry({
      "/src/lab/b.scenario.ts": scenario("Zeta"),
      "/src/lab/a.scenario.ts": scenario("Alpha"),
    });

    expect(registry.scenarios.map((s) => s.title)).toEqual(["Alpha", "Zeta"]);
    expect(registry.find("src/lab/a")?.title).toBe("Alpha");
    expect(registry.find("nope")).toBeUndefined();
    expect(registry.problems).toEqual([]);
  });

  it("gives same-named files in different folders distinct ids", () => {
    const registry = buildRegistry(
      {
        "/src/lab/player/jump.scenario.ts": scenario("Player / Jump"),
        "/src/lab/enemy/jump.scenario.ts": scenario("Enemy / Jump"),
      },
      { root: "/src/lab" },
    );

    expect(registry.scenarios.map((s) => s.id).sort()).toEqual([
      "enemy/jump",
      "player/jump",
    ]);
    expect(registry.problems).toEqual([]);
  });

  it("reports a duplicate id instead of dropping one silently", () => {
    const registry = buildRegistry({
      "/src/lab/a.scenario.ts": scenario("First"),
      "/src/lab/a.scenario.tsx": scenario("Second"),
    });

    expect(registry.scenarios).toHaveLength(1);
    expect(registry.scenarios[0]?.title).toBe("First");
    expect(registry.problems).toEqual([
      {
        path: "/src/lab/a.scenario.tsx",
        message: 'id "src/lab/a" is already used by /src/lab/a.scenario.ts.',
      },
    ]);
  });

  it("reports a module with no default export", () => {
    const registry = buildRegistry({ "/src/lab/a.scenario.ts": {} });

    expect(registry.scenarios).toEqual([]);
    expect(registry.problems[0]?.message).toMatch(/no default export/);
  });

  it("reports a default export that is not a scenario", () => {
    const registry = buildRegistry({
      "/src/lab/a.scenario.ts": { default: { title: "No builder" } },
      "/src/lab/b.scenario.ts": scenario("Fine"),
    });

    expect(registry.scenarios.map((s) => s.title)).toEqual(["Fine"]);
    expect(registry.problems[0]).toMatchObject({
      path: "/src/lab/a.scenario.ts",
      message: expect.stringContaining("`scene` or `setup`"),
    });
  });

  it("is empty and quiet when the glob matched nothing", () => {
    const registry = buildRegistry({});
    expect(registry.scenarios).toEqual([]);
    expect(registry.problems).toEqual([]);
  });
});
