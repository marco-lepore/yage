import { describe, expect, it } from "vitest";
import { describeScenarioResult, describeTestSummary } from "./report.js";
import type { ScenarioResult } from "./test.js";

/** Colour depends on whether a terminal is attached, and none of it is content. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

function plain(text: string): string[] {
  return text.replace(ANSI, "").split("\n");
}

function result(over: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id: "drop",
    title: "Physics / Ball drop",
    ok: true,
    mode: "drive",
    framesUsed: 120,
    durationMs: 240,
    failures: [],
    warnings: [],
    captures: [],
    ...over,
  };
}

describe("describeScenarioResult", () => {
  it("says how a scenario was exercised and how far it got", () => {
    const [line] = plain(describeScenarioResult(result()));

    expect(line).toMatch(/^ {2}PASS {2}drop +drive +120f {2}240ms$/);
  });

  it("counts a run over a second in seconds", () => {
    const [line] = plain(describeScenarioResult(result({ durationMs: 1_500 })));

    expect(line).toMatch(/1\.5s$/);
  });

  it("puts every reason it failed under the line", () => {
    const lines = plain(
      describeScenarioResult(
        result({
          ok: false,
          failures: ["expected 1 to be 2", "Component: boom"],
        }),
      ),
    );

    expect(lines[0]).toMatch(/^ {2}FAIL {2}drop/);
    expect(lines.slice(1, 3)).toEqual([
      "        expected 1 to be 2",
      "        Component: boom",
    ]);
  });

  it("puts a warning under a line that still passed", () => {
    const lines = plain(
      describeScenarioResult(result({ warnings: ["Screenshot failed: boom"] })),
    );

    expect(lines[0]).toMatch(/^ {2}PASS {2}drop/);
    expect(lines[1]).toBe("        Screenshot failed: boom");
  });

  it("indents an assertion message that runs to several lines", () => {
    const lines = plain(
      describeScenarioResult(
        result({ ok: false, failures: ["expected\n  { a: 1 }\nto equal"] }),
      ),
    );

    expect(lines.slice(1, 4)).toEqual([
      "        expected",
      "          { a: 1 }",
      "        to equal",
    ]);
  });
});

describe("describeTestSummary", () => {
  it("counts what passed", () => {
    expect(plain(describeTestSummary([result(), result()]))).toContain(
      "  2/2 passed",
    );
  });

  it("counts what failed too", () => {
    const results = [result(), result({ ok: false })];

    expect(plain(describeTestSummary(results))).toContain(
      "  1/2 passed, 1 failed",
    );
  });
});
