import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENARIO_GLOBS,
  resolveScenarioGlobs,
} from "./scenarioGlobs.js";

describe("resolveScenarioGlobs", () => {
  it("makes every pattern root-absolute", () => {
    const { patterns } = resolveScenarioGlobs([
      "src/**/*.scenario.ts",
      "./levels/**/*.scenario.ts",
      "/ui/**/*.scenario.ts",
    ]);

    expect(patterns.slice(0, 3)).toEqual([
      "/src/**/*.scenario.ts",
      "/levels/**/*.scenario.ts",
      "/ui/**/*.scenario.ts",
    ]);
  });

  it("excludes build output, which the glob does not skip on its own", () => {
    const { patterns } = resolveScenarioGlobs(DEFAULT_SCENARIO_GLOBS);

    expect(patterns).toEqual([
      "/**/*.scenario.ts",
      "!**/node_modules/**",
      "!**/dist/**",
    ]);
  });

  it("keeps an exclusion the project declared", () => {
    const { patterns } = resolveScenarioGlobs([
      "src/**/*.scenario.ts",
      "!src/wip/**",
    ]);

    expect(patterns).toContain("!/src/wip/**");
  });

  it("derives the id root from the literal part of one pattern", () => {
    expect(resolveScenarioGlobs(["src/lab/**/*.scenario.ts"]).root).toBe(
      "/src/lab",
    );
  });

  it("derives it from the shared part of several", () => {
    expect(
      resolveScenarioGlobs([
        "src/lab/enemies/**/*.scenario.ts",
        "src/lab/levels/**/*.scenario.ts",
      ]).root,
    ).toBe("/src/lab");
  });

  it("falls back to the Vite root when the patterns share nothing", () => {
    expect(
      resolveScenarioGlobs(["src/**/*.scenario.ts", "ui/**/*.scenario.ts"])
        .root,
    ).toBe("/");
    expect(resolveScenarioGlobs(DEFAULT_SCENARIO_GLOBS).root).toBe("/");
  });

  it("treats a trailing filename as part of the pattern, not the root", () => {
    expect(resolveScenarioGlobs(["src/lab/jump.scenario.ts"]).root).toBe(
      "/src/lab",
    );
  });

  it("keeps a directory whose name carries a dot", () => {
    expect(resolveScenarioGlobs(["src/lab.v2/**/*.scenario.ts"]).root).toBe(
      "/src/lab.v2",
    );
  });

  it("ignores exclusions when deriving the root", () => {
    expect(
      resolveScenarioGlobs(["src/lab/**/*.scenario.ts", "!src/lab/wip/**"])
        .root,
    ).toBe("/src/lab");
  });

  it("rejects a pattern list that can match nothing", () => {
    expect(() => resolveScenarioGlobs(["!src/**"])).toThrow(/exclusion/);
  });
});
