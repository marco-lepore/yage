import { describe, expect, it } from "vitest";
import { buildRegistry, scenarioIdFromPath } from "./ScenarioRegistry.js";
import { defineScenario } from "../grammar/scenario.js";

const scenario = (title: string) => ({
  default: defineScenario({ title, setup: () => {} }),
});

/** For the cases that care about placement rather than about the definition. */
const SCENARIO = defineScenario({ setup: () => {} });

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

  it("records whether a scenario declares a drive", () => {
    // On the entry rather than looked up on the definition, because a driver
    // outside the page reads this list through a bridge that drops functions.
    const registry = buildRegistry({
      "/src/a.scenario.ts": scenario("A"),
      "/src/b.scenario.ts": {
        default: defineScenario({
          title: "B",
          setup: () => {},
          drive: () => Promise.resolve(),
        }),
      },
    });

    expect(registry.find("src/a")?.hasDrive).toBe(false);
    expect(registry.find("src/b")?.hasDrive).toBe(true);
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

  it("reports a named export that collides with a file one directory down", () => {
    // `slime.scenario.ts` exporting `idle` and `slime/idle.scenario.ts` both
    // want `enemies/slime/idle`, and the message has to say which is which.
    const registry = buildRegistry(
      {
        "/src/lab/enemies/slime.scenario.ts": {
          idle: defineScenario({ setup: () => {} }),
        },
        "/src/lab/enemies/slime/idle.scenario.ts": { default: SCENARIO },
      },
      { root: "/src/lab" },
    );

    expect(registry.scenarios.map((s) => s.path)).toEqual([
      "/src/lab/enemies/slime.scenario.ts",
    ]);
    expect(registry.problems[0]?.message).toBe(
      'id "enemies/slime/idle" is already used by /src/lab/enemies/slime.scenario.ts.',
    );
  });

  it("says which export clashed when a named one loses the id", () => {
    const registry = buildRegistry({
      "/a.scenario.ts": { idle: defineScenario({ setup: () => {} }) },
      "/a.scenario.tsx": { idle: defineScenario({ setup: () => {} }) },
    });

    expect(registry.problems[0]?.message).toBe(
      'id "a/idle" (export `idle`) is already used by /a.scenario.ts.',
    );
  });

  it("lets a scenario name itself under a title that placed it", () => {
    // `title` is the path and `name` is the leaf, so together the title's last
    // segment is the one the name replaces.
    const registry = buildRegistry({
      "/a.scenario.ts": {
        king: defineScenario({
          title: "Bosses / Slime King",
          name: "King",
          setup: () => {},
        }),
      },
    });

    expect(registry.scenarios[0]).toMatchObject({
      groups: ["Bosses"],
      label: "King",
    });
  });

  it("reports a module that exports no scenario", () => {
    const registry = buildRegistry({ "/src/lab/a.scenario.ts": {} });

    expect(registry.scenarios).toEqual([]);
    expect(registry.problems[0]?.message).toMatch(/no scenarios/);
  });

  it("ignores an export that is not a scenario", () => {
    // A scenario file holds the helpers its scenarios share, and those are
    // exported so the file's own scenarios can be split across it later.
    const registry = buildRegistry({
      "/src/lab/a.scenario.ts": {
        ARENA_WIDTH: 640,
        spawnSlime: () => {},
        idle: defineScenario({ setup: () => {} }),
      },
    });

    expect(registry.scenarios.map((s) => s.id)).toEqual(["src/lab/a/idle"]);
    expect(registry.problems).toEqual([]);
  });

  it("takes a scenario from every named export", () => {
    const registry = buildRegistry(
      {
        "/src/lab/enemies/slime.scenario.ts": {
          chase: defineScenario({ setup: () => {} }),
          idle: defineScenario({ setup: () => {} }),
        },
      },
      { root: "/src/lab" },
    );

    expect(registry.scenarios.map((s) => [s.id, s.groups, s.label])).toEqual([
      ["enemies/slime/chase", ["enemies", "slime"], "chase"],
      ["enemies/slime/idle", ["enemies", "slime"], "idle"],
    ]);
  });

  it("keeps the file's own id for its unnamed scenario", () => {
    // One scenario in a file needs no group of its own, so the file is the
    // entry rather than a folder holding a single child.
    const registry = buildRegistry(
      { "/src/lab/enemies/slime.scenario.ts": { default: SCENARIO } },
      { root: "/src/lab" },
    );

    expect(registry.scenarios[0]).toMatchObject({
      id: "enemies/slime",
      groups: ["enemies"],
      label: "slime",
      exportName: "default",
    });
  });

  it("refuses a file that exports a default scenario and named ones", () => {
    // The file would be a leaf and a group of the same name, side by side.
    const registry = buildRegistry({
      "/src/lab/a.scenario.ts": { default: SCENARIO, idle: SCENARIO },
    });

    expect(registry.scenarios).toEqual([]);
    expect(registry.problems[0]?.message).toMatch(/use one or the other/);
  });

  it("names the scenario itself when it says so", () => {
    const registry = buildRegistry(
      {
        "/src/lab/enemies/slime.scenario.ts": {
          chase: defineScenario({
            name: "Chasing the player",
            setup: () => {},
          }),
        },
      },
      { root: "/src/lab" },
    );

    expect(registry.scenarios[0]).toMatchObject({
      id: "enemies/slime/chase",
      groups: ["enemies", "slime"],
      label: "Chasing the player",
    });
  });

  it("lets a title move a scenario without moving its id", () => {
    // The id addresses the file, so `--scenarios` and a saved link keep
    // working when a scenario is shown somewhere else in the list.
    const registry = buildRegistry(
      {
        "/src/lab/enemies/slime.scenario.ts": {
          king: defineScenario({
            title: "Bosses / Slime King",
            setup: () => {},
          }),
        },
      },
      { root: "/src/lab" },
    );

    expect(registry.scenarios[0]).toMatchObject({
      id: "enemies/slime/king",
      groups: ["Bosses"],
      label: "Slime King",
    });
  });

  it("is empty and quiet when the glob matched nothing", () => {
    const registry = buildRegistry({});
    expect(registry.scenarios).toEqual([]);
    expect(registry.problems).toEqual([]);
  });
});
