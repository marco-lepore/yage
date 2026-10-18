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

/** What one case of the fixture reported. */
export type CaseReading = Record<string, unknown>;

/** What the fixture's test profile reports about itself. */
export interface BaselineReading {
  target: string;
  profile: string;
  bootId: string;
  cases: string[];
  settledCases: string[];
  settled: boolean;
  readings: Record<string, CaseReading>;
  host: {
    info: { runtime: string; os: string };
    lifecycle: { activity: string; visibility: string; focus: string };
    active: boolean;
    activeWhenUnfocused: boolean;
  };
  errors: { callbackErrors: unknown[] };
  /** Every `graphics:context` payload the page has seen, oldest first. */
  graphicsContext: boolean[];
  /** What the page's content security policy allows. */
  policy: { stringEvaluation: boolean };
  userAgent: string;
}

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
  return resolve(
    screenshotsDir,
    `${report.target}-${report.profile}-${step}.png`,
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

  const sprites = readings["sprites"];
  if (sprites) {
    check(
      "sprites: the texture loaded",
      JSON.stringify(sprites),
      Number(sprites["textureWidth"]) > 0 &&
        Number(sprites["textureHeight"]) > 0 &&
        sprites["visible"] === true,
    );
  }
  const textUi = readings["text-ui"];
  if (textUi) {
    check(
      "text-ui: the panel is laid out",
      JSON.stringify(textUi),
      Number(textUi["textWidth"]) > 0 &&
        textUi["panelWidth"] === 200 &&
        Number(textUi["panelHeight"]) > 20,
    );
  }
  const masks = readings["masks"];
  if (masks) {
    check(
      "masks: the mask stayed attached",
      JSON.stringify(masks),
      masks["maskAttached"] === true,
    );
  }
  const renderTargets = readings["render-targets"];
  if (renderTargets) {
    check(
      "render-targets: the buffer drew",
      JSON.stringify(renderTargets),
      renderTargets["width"] === 128 &&
        renderTargets["height"] === 64 &&
        renderTargets["resolution"] === renderTargets["rendererResolution"],
    );
  }
  const effects = readings["effects"];
  if (effects) {
    const names = effects["effects"];
    check(
      "effects: both effects attached",
      JSON.stringify(effects),
      Array.isArray(names) &&
        names.includes("yage:outline") &&
        names.includes("baseline:tint"),
    );
  }
  const lighting = readings["lighting"];
  if (lighting) {
    check(
      "lighting: the lamp lights its own position",
      JSON.stringify(lighting),
      Number(lighting["levelAtLight"]) > Number(lighting["levelFar"]),
    );
  }
  const physics = readings["physics"];
  if (physics) {
    check(
      "physics: the ball fell and landed",
      JSON.stringify(physics),
      Number(physics["y"]) > Number(physics["startY"]) &&
        Number(physics["contacts"]) >= 1,
    );
  }
  const workers = readings["workers"];
  if (workers) {
    check(
      "workers: the worker answered",
      JSON.stringify(workers),
      workers["reply"] === 42,
    );
  }
  const saves = readings["saves"];
  if (saves) {
    check(
      "saves: a clean profile starts at zero",
      JSON.stringify(saves),
      saves["launchesBefore"] === 0 &&
        saves["launchesAfter"] === 1 &&
        saves["slotBefore"] === null &&
        saves["slotAfter"] === 1,
    );
  }
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
