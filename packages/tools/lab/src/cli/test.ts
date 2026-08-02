import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserType, Page } from "@playwright/test";
import pc from "picocolors";
import { createServer, mergeConfig, type InlineConfig } from "vite";
import { LAB_GLOBAL } from "../runner/labGlobal.js";
import type { LabApi } from "../runner/mountLab.js";
import type { DriveCapture } from "../runner/runDrive.js";
import { createLabConfig } from "./labConfig.js";
import {
  describeProject,
  describeScenarioResult,
  describeTestSummary,
} from "./report.js";

/** Frames a scenario without a `drive` is stepped for — one second at 60fps. */
const SMOKE_FRAMES = 60;

/** How a scenario was exercised. */
export type ScenarioMode = "drive" | "smoke" | "skipped";

export interface ScenarioResult {
  /** The scenario id, or the module path for a file that could not be loaded. */
  readonly id: string;
  readonly title: string;
  readonly ok: boolean;
  readonly mode: ScenarioMode;
  /** Frames the run issued. */
  readonly framesUsed: number;
  readonly durationMs: number;
  /** One entry per reason it failed. Empty when it passed. */
  readonly failures: readonly string[];
  /** Reported alongside the result without failing it. */
  readonly warnings: readonly string[];
  /** What the scenario asked for, plus the driver's own final screenshot. */
  readonly captures: readonly DriveCapture[];
}

/** One scenario as it survives being read out of the page. */
interface ScenarioListing {
  readonly id: string;
  readonly title: string;
  readonly hasDrive: boolean;
}

/** What one page visit produced, before the driver's own findings are added. */
interface PageOutcome {
  readonly mode: ScenarioMode;
  readonly framesUsed: number;
  readonly durationMs: number;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
  readonly captures: readonly DriveCapture[];
}

const TIMED_OUT = Symbol("timed out");

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Races `work` against a deadline. The loser is abandoned rather than
 * cancelled, so the caller has to throw the page away after a timeout — a page
 * that never answered may still be running the scenario.
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The lab, once the module has run and the first scenario has settled. */
async function waitForLab(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    (key) => Boolean((globalThis as Record<string, unknown>)[key]),
    LAB_GLOBAL,
    { timeout: timeoutMs },
  );
  await page.evaluate((key) => {
    const api = (globalThis as unknown as Record<string, LabApi | undefined>)[
      key
    ];
    if (!api) throw new Error("The lab is not mounted on this page.");
    return api.ready;
  }, LAB_GLOBAL);
}

/**
 * Runs the scenario the page opened on and reports what happened.
 *
 * A scenario with a `drive` is driven; one without is mounted and stepped,
 * which is enough to catch a scene that throws while it builds or runs.
 */
async function exercise(page: Page, capture: boolean): Promise<PageOutcome> {
  return page.evaluate(
    async ({ key, smokeFrames, wantCapture }) => {
      const api = (globalThis as unknown as Record<string, LabApi | undefined>)[
        key
      ];
      if (!api) throw new Error("The lab is not mounted on this page.");
      const say = (error: unknown): string =>
        error instanceof Error ? error.message : String(error);

      const inspector = api.engine.inspector;
      const failures: string[] = [];
      const warnings: string[] = [];
      let captures: DriveCapture[] = [];
      let framesUsed = 0;
      let durationMs = 0;

      const entry = api.current();
      const mode = entry?.hasDrive === true ? "drive" : "smoke";
      const startFrame = inspector.time.getFrame();
      const startedAt = performance.now();

      if (!entry) {
        failures.push("No scenario is mounted.");
      } else if (entry.hasDrive) {
        try {
          const result = await api.run();
          framesUsed = result.framesUsed;
          durationMs = result.durationMs;
          // Only when they get written: each one crosses the bridge out of the
          // page as a base64 PNG.
          if (wantCapture) captures = [...result.captures];
          if (!result.ok) failures.push(result.error);
        } catch (error) {
          // `run` reports a failed assertion rather than throwing, so this is
          // the rebuild before it — the run that never happened.
          failures.push(say(error));
        }
      } else {
        try {
          await api.clock.step(smokeFrames);
        } catch (error) {
          failures.push(say(error));
        }
        framesUsed = inspector.time.getFrame() - startFrame;
        durationMs = performance.now() - startedAt;
      }

      // The whole page belongs to this scenario, so every error the engine
      // recorded is its own — including one from the mount, which happened
      // before this call. One fault reaches this loop more than once: a
      // rebuild runs `setup` again, and a `setup` that throws is also
      // attributed to the hook it threw from, which is the line that says
      // more.
      const recorded: string[] = [];
      const messages = new Set<string>();
      for (const record of inspector.getErrors().callbackErrors) {
        const where = [record.scene, record.entity, record.event]
          .filter((part) => part !== undefined && part !== "")
          .join(" · ");
        const line = `${record.kind}: ${record.error}${where === "" ? "" : ` (${where})`}`;
        if (!recorded.includes(line)) recorded.push(line);
        messages.add(record.error);
      }
      const own = failures.filter((failure) => !messages.has(failure));

      if (wantCapture) {
        try {
          captures = [
            ...captures,
            { dataUrl: await inspector.capture.dataURL() },
          ];
        } catch (error) {
          // The scenario is what this command reports on. A screenshot is an
          // artifact of the run, so failing to take one is not a failed run.
          warnings.push(`Screenshot failed: ${say(error)}`);
        }
      }

      return {
        mode,
        framesUsed,
        durationMs,
        failures: [...own, ...recorded],
        warnings,
        captures,
      };
    },
    { key: LAB_GLOBAL, smokeFrames: SMOKE_FRAMES, wantCapture: capture },
  );
}

export interface DriveScenariosOptions {
  browser: Browser;
  /** Where the lab is served, without a query string. */
  baseUrl: string;
  /** How long one scenario may take, in milliseconds. */
  timeoutMs: number;
  /** Screenshot each scenario. Only worth the readback when they get written. */
  capture: boolean;
  /** Called as each scenario finishes, so a long run reports as it goes. */
  onResult?: ((result: ScenarioResult) => void) | undefined;
}

/**
 * The scenarios the lab found, and the files it could not use.
 *
 * Read from a page of its own, before the first scenario runs: a project with
 * a broken harness has nothing to report per scenario, and the whole run is
 * what failed.
 */
async function readScenarios(
  browser: Browser,
  baseUrl: string,
  timeoutMs: number,
): Promise<{
  scenarios: readonly ScenarioListing[];
  problems: readonly { path: string; message: string }[];
}> {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const work = (async () => {
      await page.goto(`${baseUrl}?paused=1`, { timeout: timeoutMs });
      await waitForLab(page, timeoutMs);
      return page.evaluate((key) => {
        const api = (
          globalThis as unknown as Record<string, LabApi | undefined>
        )[key];
        if (!api) throw new Error("The lab is not mounted on this page.");
        // Mapped rather than returned whole: a scenario definition holds
        // functions, which do not survive being read out of the page.
        return {
          scenarios: api.scenarios.map((entry) => ({
            id: entry.id,
            title: entry.title,
            hasDrive: entry.hasDrive,
          })),
          problems: api.problems.map((problem) => ({
            path: problem.path,
            message: problem.message,
          })),
        };
      }, LAB_GLOBAL);
    })();

    const found = await withTimeout(work, timeoutMs);
    if (found === TIMED_OUT) {
      throw new Error(
        `The lab did not finish starting within ${timeoutMs} ms.` +
          (pageErrors.length === 0 ? "" : `\n  ${pageErrors.join("\n  ")}`),
      );
    }
    return found;
  } finally {
    await page.close();
  }
}

/** One scenario, in a page of its own. */
async function testScenario(
  entry: ScenarioListing,
  opts: DriveScenariosOptions,
): Promise<ScenarioResult> {
  const page = await opts.browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) =>
    pageErrors.push(`Uncaught: ${error.message}`),
  );
  const startedAt = performance.now();
  const failed = (
    failures: readonly string[],
    outcome?: PageOutcome,
  ): ScenarioResult => ({
    id: entry.id,
    title: entry.title,
    ok: false,
    mode: outcome?.mode ?? (entry.hasDrive ? "drive" : "smoke"),
    framesUsed: outcome?.framesUsed ?? 0,
    durationMs: outcome?.durationMs ?? performance.now() - startedAt,
    failures,
    warnings: outcome?.warnings ?? [],
    captures: outcome?.captures ?? [],
  });

  try {
    // `paused=1`: headless chromium runs requestAnimationFrame normally, so a
    // panel clock left playing would advance the engine between these calls.
    const url = `${opts.baseUrl}?scenario=${encodeURIComponent(entry.id)}&paused=1`;
    const work = (async () => {
      await page.goto(url, { timeout: opts.timeoutMs });
      await waitForLab(page, opts.timeoutMs);
      return exercise(page, opts.capture);
    })();

    const outcome = await withTimeout(work, opts.timeoutMs);
    if (outcome === TIMED_OUT) {
      return failed([
        `Timed out after ${opts.timeoutMs} ms. A drive that waits without ` +
          `stepping never finishes — during a run, the drive is the only ` +
          `thing issuing frames.`,
        ...pageErrors,
      ]);
    }

    const failures = [...outcome.failures, ...pageErrors];
    if (failures.length > 0) return failed(failures, outcome);
    return {
      id: entry.id,
      title: entry.title,
      ok: true,
      mode: outcome.mode,
      framesUsed: outcome.framesUsed,
      durationMs: outcome.durationMs,
      failures: [],
      warnings: outcome.warnings,
      captures: outcome.captures,
    };
  } catch (error) {
    return failed([describeError(error), ...pageErrors]);
  } finally {
    await page.close();
  }
}

/**
 * Runs every scenario the lab found, one page at a time.
 *
 * A page each rather than one page throughout: a throw that escapes a frame
 * stops the engine's game loop for good, and every later scenario sharing that
 * page would fail for a reason that is not its own.
 */
export async function driveScenarios(
  opts: DriveScenariosOptions,
): Promise<readonly ScenarioResult[]> {
  const found = await readScenarios(opts.browser, opts.baseUrl, opts.timeoutMs);
  const results: ScenarioResult[] = [];

  // A file the lab could not load is a hole in what this command covers, so it
  // fails the run rather than warning the way the panel does.
  for (const problem of found.problems) {
    const result: ScenarioResult = {
      id: problem.path,
      title: problem.path,
      ok: false,
      mode: "skipped",
      framesUsed: 0,
      durationMs: 0,
      failures: [problem.message],
      warnings: [],
      captures: [],
    };
    results.push(result);
    opts.onResult?.(result);
  }

  for (const entry of found.scenarios) {
    const result = await testScenario(entry, opts);
    results.push(result);
    opts.onResult?.(result);
  }
  return results;
}

/**
 * Chromium, from the optional peer dependency. `@playwright/test` exports it
 * directly, so a project that already runs Playwright tests needs nothing else.
 */
async function loadChromium(): Promise<BrowserType> {
  try {
    const playwright = await import("@playwright/test");
    return playwright.chromium;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    throw new Error(
      "`yage-lab test` runs scenarios in a headless browser, which needs @playwright/test:\n" +
        "    npm i -D @playwright/test && npx playwright install chromium",
      { cause: error },
    );
  }
}

/** Turns a label into something that can be a filename. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Writes every screenshot a run collected. Returns how many files it wrote. */
function writeCaptures(
  dir: string,
  results: readonly ScenarioResult[],
): number {
  let written = 0;
  // Sanitizing maps more than one id onto a name — `a/b` and `a-b` both give
  // `a-b` — and the second write would replace the first scenario's PNG.
  const taken = new Set<string>();
  for (const result of results) {
    if (result.captures.length === 0) continue;
    mkdirSync(dir, { recursive: true });
    result.captures.forEach((capture, index) => {
      const parts = [result.id];
      if (result.captures.length > 1) parts.push(String(index + 1));
      if (capture.label !== undefined) parts.push(capture.label);
      const base64 = capture.dataUrl.slice(capture.dataUrl.indexOf(",") + 1);
      writeFileSync(
        path.join(dir, `${claimName(taken, sanitize(parts.join("-")))}.png`),
        Buffer.from(base64, "base64"),
      );
      written++;
    });
  }
  return written;
}

/** `name`, or the first `name-2`, `name-3`, … no other capture has taken. */
function claimName(taken: Set<string>, name: string): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = `${name}-${n}`;
  taken.add(candidate);
  return candidate;
}

export interface TestOptions {
  cwd: string;
  scenarios?: readonly string[] | undefined;
  /** How long one scenario may take, in milliseconds. */
  timeoutMs: number;
  /** Where PNGs go, relative to the Vite root. Nothing is written without it. */
  screenshots?: string | undefined;
}

/**
 * Runs every scenario headless against the project's own Vite config, and
 * reports each one. Resolves with the exit code: non-zero is what makes the
 * command a gate.
 */
export async function runTest(opts: TestOptions): Promise<number> {
  const chromium = await loadChromium();
  const lab = await createLabConfig({
    cwd: opts.cwd,
    env: { command: "serve", mode: "development" },
    scenarios: opts.scenarios,
  });

  process.stdout.write(`\n  ${pc.green("yage-lab")} ${pc.dim("test")}\n`);
  process.stdout.write(describeProject(lab));

  const server = await createServer(
    mergeConfig(lab.config, {
      appType: "custom",
      logLevel: "warn",
      server: {
        // Any free port: a gate should not fail because a dev server holds the
        // one the lab usually browses on.
        port: 0,
        // The report already carries what the engine recorded, and a stack
        // relayed from every page would bury it.
        forwardConsole: false,
      },
    } satisfies InlineConfig),
  );
  // A listening server keeps node's event loop alive, and the command only
  // sets an exit code rather than forcing one, so anything that throws between
  // here and the report has to close the server on its way out. Launching a
  // browser that was never installed is the likeliest of them.
  let results: readonly ScenarioResult[];
  try {
    await server.listen();
    const baseUrl = server.resolvedUrls?.local[0];
    if (baseUrl === undefined) {
      throw new Error("The lab server started without a URL to visit.");
    }
    const browser = await chromium.launch();
    try {
      results = await driveScenarios({
        browser,
        baseUrl,
        timeoutMs: opts.timeoutMs,
        capture: opts.screenshots !== undefined,
        onResult: (result) =>
          process.stdout.write(describeScenarioResult(result)),
      });
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }

  // A glob that matches nothing would otherwise be a green gate covering
  // nothing, which is the one failure this command cannot afford to be quiet
  // about.
  if (results.length === 0) {
    process.stderr.write(
      `\n  ${pc.red("No scenario matched")} ${lab.scenarios.join(", ")}\n\n`,
    );
    return 1;
  }

  if (opts.screenshots !== undefined) {
    const dir = path.resolve(lab.root, opts.screenshots);
    const written = writeCaptures(dir, results);
    process.stdout.write(
      `\n  ${pc.dim("screenshots")} ${written} in ${path.relative(opts.cwd, dir) || dir}\n`,
    );
  }
  process.stdout.write(describeTestSummary(results));
  return results.every((result) => result.ok) ? 0 : 1;
}
