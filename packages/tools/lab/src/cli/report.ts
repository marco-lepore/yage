import path from "node:path";
import pc from "picocolors";
import type { LabConfig } from "./labConfig.js";
import type { ScenarioResult } from "./test.js";

/**
 * The two things that decide what a run browses: which config it extended and
 * which files it searched. Both are guessed from the project unless the caller
 * says otherwise, so both are worth showing.
 */
export function describeProject(lab: LabConfig): string {
  const config = lab.configFile
    ? path.relative(lab.root, lab.configFile) || lab.configFile
    : "none — using Vite's defaults";
  return (
    `  ${pc.dim("config")}     ${config}\n` +
    `  ${pc.dim("scenarios")}  ${lab.scenarios.join(", ")}\n\n`
  );
}

/**
 * Width of the id column. Fixed rather than measured, so a line can be printed
 * as its scenario finishes; a longer id widens its own line and no other.
 */
const ID_WIDTH = 28;

function describeDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** One scenario's line, with a line per reason it failed under it. */
export function describeScenarioResult(result: ScenarioResult): string {
  const tag = result.ok ? pc.green("PASS") : pc.red("FAIL");
  const frames = `${result.framesUsed}f`;
  const line =
    `  ${tag}  ${result.id.padEnd(ID_WIDTH)}  ${pc.dim(result.mode.padEnd(7))}` +
    `${pc.dim(frames.padStart(6))}  ${pc.dim(describeDuration(result.durationMs))}\n`;
  // An assertion message runs to several lines, and each of them belongs under
  // the scenario that produced it.
  const reasons = result.failures.flatMap((failure) => failure.split("\n"));
  const notes = result.warnings.flatMap((warning) => warning.split("\n"));
  return (
    line +
    reasons.map((reason) => `        ${pc.red(reason)}\n`).join("") +
    notes.map((note) => `        ${pc.yellow(note)}\n`).join("")
  );
}

/** The count a run ends on. */
export function describeTestSummary(
  results: readonly ScenarioResult[],
): string {
  const failed = results.filter((result) => !result.ok).length;
  const counts = `${results.length - failed}/${results.length} passed`;
  return failed === 0
    ? `\n  ${pc.green(counts)}\n\n`
    : `\n  ${pc.red(`${counts}, ${failed} failed`)}\n\n`;
}
