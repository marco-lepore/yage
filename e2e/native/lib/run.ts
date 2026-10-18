import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { workDir } from "./paths.js";
import {
  hashWebDir,
  readEngineProvenance,
  readSystem,
  resolvedDependencies,
} from "./report.js";
import type { BaselineRunReport, ReportCheck, ReportTarget } from "./report.js";
import type { BaselineProfile } from "./build.js";
import type { CaseReading } from "../../fixtures/src/baseline/probe.js";
import type { BaselineReading } from "../../fixtures/src/baseline/types.js";

export type { CaseReading, BaselineReading };

/** Where a run's screenshots land. */
export const screenshotsDir = resolve(workDir, "screenshots");

/** A report with everything a run knows before it launches anything. */
export async function startReport(
  target: ReportTarget,
  profile: BaselineProfile,
  webDir: string,
): Promise<BaselineRunReport> {
  const build = await hashWebDir(webDir);
  return {
    schema: 1,
    run: {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      finishedAt: "",
      status: "failed",
      failure: null,
    },
    target,
    profile,
    subject: { kind: "fixture" },
    engine: await readEngineProvenance(),
    dependencies: resolvedDependencies(),
    shell: { kind: shellKindFor(target), version: "unknown", details: {} },
    system: readSystem(),
    webView: { userAgent: null },
    build: { webDir, files: build.files, digest: build.digest },
    checks: [],
    readings: [],
    timeline: [],
    errors: {
      page: [],
      console: [],
      requestFailures: [],
      callback: [],
      shell: [],
    },
    screenshots: [],
  };
}

function shellKindFor(
  target: ReportTarget,
): BaselineRunReport["shell"]["kind"] {
  if (target === "browser") return "chromium";
  if (target === "electron") return "electron";
  return "capacitor";
}

/** Record what a step read, with the time it was read at. */
export function recordReading(
  report: BaselineRunReport,
  step: string,
  reading: unknown,
): void {
  report.readings.push({
    step,
    at: new Date().toISOString(),
    reading,
  });
}

/** Record one check's outcome. */
export function record(
  report: BaselineRunReport,
  check: ReportCheck,
): ReportCheck {
  report.checks.push(check);
  return check;
}

/** Record a check that could not run on this machine, and why. */
export function recordPending(
  report: BaselineRunReport,
  name: string,
  reason: string,
): void {
  record(report, {
    name,
    result: "pending",
    evidence: "harness",
    detail: reason,
  });
}

/** Where a screenshot of one step belongs. */
export async function screenshotPath(
  report: BaselineRunReport,
  step: string,
): Promise<string> {
  await mkdir(screenshotsDir, { recursive: true });
  // Stamped like the report file, so each report points at its own image.
  const stamp = report.run.startedAt.replace(/[:.]/g, "-");
  return resolve(
    screenshotsDir,
    `${report.target}-${report.profile}-${stamp}-${step}.png`,
  );
}

/**
 * What every case reports that does not depend on the host. The host's own
 * answers (audio, input, lifecycle and display) get no check: they stay in
 * the step's reading the caller records, because a shell is free to answer
 * them differently.
 */
export function checkReadings(
  report: BaselineRunReport,
  readings: Record<string, CaseReading>,
): string[] {
  const failures: string[] = [];
  const check = (
    name: string,
    detail: string | null,
    passed: boolean,
  ): void => {
    record(report, {
      name,
      result: passed ? "passed" : "failed",
      evidence: "inspector",
      detail,
    });
    if (!passed) failures.push(`${name}: ${detail ?? "no detail"}`);
  };

  // A case whose reading is missing fails its check: on iOS the readings
  // come from console lines, and one that never arrived would otherwise
  // leave no row at all.
  const caseCheck = (
    caseName: string,
    name: string,
    passes: (reading: CaseReading) => boolean,
  ): void => {
    const reading = readings[caseName];
    if (reading === undefined) {
      check(name, "no reading", false);
      return;
    }
    check(name, JSON.stringify(reading), passes(reading));
  };

  caseCheck(
    "sprites",
    "sprites: the texture loaded",
    (sprites) =>
      Number(sprites["textureWidth"]) > 0 &&
      Number(sprites["textureHeight"]) > 0 &&
      sprites["visible"] === true,
  );
  caseCheck(
    "text-ui",
    "text-ui: the panel is laid out",
    (textUi) =>
      Number(textUi["textWidth"]) > 0 &&
      textUi["panelWidth"] === 200 &&
      Number(textUi["panelHeight"]) > 20,
  );
  caseCheck(
    "masks",
    "masks: the mask stayed attached",
    (masks) => masks["maskAttached"] === true,
  );
  caseCheck(
    "render-targets",
    "render-targets: the buffer drew",
    (renderTargets) =>
      renderTargets["width"] === 128 &&
      renderTargets["height"] === 64 &&
      renderTargets["resolution"] === renderTargets["rendererResolution"],
  );
  caseCheck("effects", "effects: both effects attached", (effects) => {
    const names = effects["effects"];
    return (
      Array.isArray(names) &&
      names.includes("yage:outline") &&
      names.includes("baseline:tint")
    );
  });
  caseCheck(
    "lighting",
    "lighting: the lamp lights its own position",
    (lighting) =>
      Number(lighting["levelAtLight"]) > Number(lighting["levelFar"]),
  );
  caseCheck(
    "physics",
    "physics: the ball fell and landed",
    (physics) =>
      Number(physics["y"]) > Number(physics["startY"]) &&
      Number(physics["contacts"]) >= 1,
  );
  caseCheck(
    "workers",
    "workers: the worker answered",
    (workers) => workers["reply"] === 42,
  );
  caseCheck(
    "saves",
    "saves: a clean profile starts at zero",
    (saves) =>
      saves["launchesBefore"] === 0 &&
      saves["launchesAfter"] === 1 &&
      saves["slotBefore"] === null &&
      saves["slotAfter"] === 1,
  );
  return failures;
}

/** Close a report: stamp the outcome and the time it finished. */
export function finishReport(
  report: BaselineRunReport,
  failure: unknown,
): void {
  report.run.finishedAt = new Date().toISOString();
  if (failure === undefined || failure === null) {
    const failed = report.checks.filter((check) => check.result === "failed");
    report.run.status = failed.length === 0 ? "passed" : "failed";
    report.run.failure =
      failed.length === 0 ? null : failed.map((check) => check.name).join("; ");
    return;
  }
  report.run.status = "failed";
  report.run.failure =
    failure instanceof Error ? failure.message : String(failure);
}
