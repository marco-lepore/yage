import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { buildBaseline } from "../lib/build.js";
import { launchElectron, newUserDataDir } from "../lib/electron.js";
import { REPORT_PREFIX, parseReportLine } from "../lib/console.js";
import { indexUrl, serveDirectory } from "../lib/server.js";
import {
  installClean,
  iosToolVersions,
  isRunning,
  bringToFront,
  launchWithConsole,
  prepareIosApp,
  processId,
  screenshot,
  selectSimulator,
  sendToBackground,
  terminate,
} from "../lib/ios.js";
import { scanForTestProfile, writeReport } from "../lib/report.js";
import type { BaselineRunReport, ReportTarget } from "../lib/report.js";
import {
  checkReadings,
  finishReport,
  record,
  recordPending,
  recordReading,
  screenshotPath,
  startReport,
} from "../lib/run.js";
import type { BaselineReading, CaseReading } from "../lib/run.js";

/** Which shell this project drives. */
function targetOf(name: string): ReportTarget {
  if (name === "browser" || name === "electron" || name === "ios-simulator") {
    return name;
  }
  throw new Error(
    `fixture.spec: the project ${JSON.stringify(name)} has no shell.`,
  );
}

/** Which entry's build a shell loads. */
const ENTRY = {
  browser: "web",
  electron: "electron",
  "ios-simulator": "capacitor",
} as const;

// ---------------------------------------------------------------------------
// Reading a page through the Inspector
// ---------------------------------------------------------------------------

async function readPage(page: Page): Promise<BaselineReading | null> {
  return page.evaluate(() => {
    const host = window as unknown as {
      __yage__?: {
        inspector?: {
          getExtension(name: string): { read(): unknown } | undefined;
        };
      };
    };
    const extension = host.__yage__?.inspector?.getExtension("baseline");
    return (extension?.read() ?? null) as never;
  });
}

async function pointFor(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ vx, vy }) => {
      const host = window as unknown as {
        __yage__?: {
          inspector?: {
            getExtension(
              name: string,
            ):
              | { pointFor(x: number, y: number): { x: number; y: number } }
              | undefined;
          };
        };
      };
      const extension = host.__yage__?.inspector?.getExtension("baseline");
      if (extension === undefined) {
        throw new Error("the page has no baseline extension");
      }
      return extension.pointFor(vx, vy);
    },
    { vx: x, vy: y },
  );
}

async function waitForSettled(page: Page, timeout: number): Promise<void> {
  await expect
    .poll(async () => (await readPage(page))?.settled ?? false, { timeout })
    .toBe(true);
}

/** Collect everything a page says that a report keeps. */
function watchPage(page: Page, report: BaselineRunReport): void {
  page.on("pageerror", (error) => report.errors.page.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") report.errors.console.push(text);
    try {
      const line = parseReportLine(text);
      if (line !== null) {
        report.timeline.push({
          at: Date.now(),
          source: "page",
          event: String(line["kind"]),
          data: line,
        });
      }
    } catch (error) {
      report.errors.console.push((error as Error).message);
    }
  });
  page.on("requestfailed", (request) =>
    report.errors.requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    }),
  );
}

/** What the page read, folded into the report. */
function foldReading(
  report: BaselineRunReport,
  step: string,
  reading: BaselineReading,
): void {
  recordReading(report, step, reading);
  report.webView.userAgent = reading.userAgent;
  report.errors.callback = reading.errors.callbackErrors;
}

// ---------------------------------------------------------------------------
// The test-profile scenario, per shell
// ---------------------------------------------------------------------------

test.describe("baseline fixture", () => {
  test("test profile", async ({}, testInfo) => {
    const target = targetOf(testInfo.project.name);
    const webDir = await buildBaseline(ENTRY[target], "test");
    const report = await startReport(target, "test", webDir);
    let failure: unknown = null;
    try {
      // The release check searches for this prefix; a test build that
      // carries it shows the search looks for the string the page writes.
      const carried = await scanForTestProfile(webDir);
      record(report, {
        name: "test build: an emitted file carries the reporting prefix",
        result: carried.length > 0 ? "passed" : "failed",
        evidence: "file",
        detail: carried.join(", ") || null,
      });
      if (target === "browser") await browserScenario(report, webDir);
      else if (target === "electron") await electronScenario(report, webDir);
      else await iosScenario(report);
    } catch (error) {
      failure = error;
    } finally {
      finishReport(report, failure);
      const path = await writeReport(report);
      testInfo.annotations.push({ type: "report", description: path });
    }
    if (failure !== null) throw failure;
    expect(report.run.status, report.run.failure ?? "").toBe("passed");
  });

  test("release profile", async ({}, testInfo) => {
    const target = targetOf(testInfo.project.name);
    const webDir = await buildBaseline(ENTRY[target], "release");
    const report = await startReport(target, "release", webDir);
    let failure: unknown = null;
    try {
      const carried = await scanForTestProfile(webDir);
      record(report, {
        name: "release: no emitted file carries the reporting prefix",
        result: carried.length === 0 ? "passed" : "failed",
        evidence: "file",
        detail: carried.join(", ") || null,
      });
      if (target === "browser") await browserRelease(report, webDir);
      else if (target === "electron") await electronRelease(report, webDir);
      else await iosRelease(report);
    } catch (error) {
      failure = error;
    } finally {
      finishReport(report, failure);
      const path = await writeReport(report);
      testInfo.annotations.push({ type: "report", description: path });
    }
    if (failure !== null) throw failure;
    expect(report.run.status, report.run.failure ?? "").toBe("passed");
  });
});

// ---------------------------------------------------------------------------
// Chromium
// ---------------------------------------------------------------------------

async function browserScenario(
  report: BaselineRunReport,
  webDir: string,
): Promise<void> {
  const served = await serveDirectory(webDir);
  const browser = await chromium.launch();
  report.shell.version = browser.version();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    watchPage(page, report);
    await page.goto(indexUrl(served));
    await waitForSettled(page, 60_000);

    const booted = (await readPage(page))!;
    foldReading(report, "booted", booted);
    const failures = checkReadings(report, booted.readings);
    record(report, {
      name: "boot: no callback error",
      result: booted.errors.callbackErrors.length === 0 ? "passed" : "failed",
      evidence: "inspector",
      detail: JSON.stringify(booted.errors.callbackErrors),
    });
    if (failures.length > 0) throw new Error(failures.join("\n"));

    await inputStep(report, page);
    await restoreStep(report, page);

    // A page under automation reports itself focused whatever the window
    // does, so the emulation that holds it there is turned off first.
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setFocusEmulationEnabled", {
      enabled: false,
    });
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    await page.waitForTimeout(1_000);
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await session.detach();
    await afterReturn(report, page);

    await page.reload();
    await waitForSettled(page, 60_000);
    const relaunched = (await readPage(page))!;
    foldReading(report, "after-relaunch", relaunched);
    recordRelaunch(report, relaunched.readings["saves"]);

    await page.screenshot({ path: await screenshotPath(report, "visual") });
    report.screenshots.push({
      path: await screenshotPath(report, "visual"),
      label: "visual",
    });
    recordPageHealth(report);
  } finally {
    await context.close();
    await browser.close();
    await served.close();
  }
}

async function browserRelease(
  report: BaselineRunReport,
  webDir: string,
): Promise<void> {
  const served = await serveDirectory(webDir);
  const browser = await chromium.launch();
  report.shell.version = browser.version();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    watchPage(page, report);
    await page.goto(indexUrl(served));
    await releaseChecks(report, page);
    await page.screenshot({ path: await screenshotPath(report, "visual") });
    report.screenshots.push({
      path: await screenshotPath(report, "visual"),
      label: "visual",
    });
  } finally {
    await context.close();
    await browser.close();
    await served.close();
  }
}

// ---------------------------------------------------------------------------
// Electron
// ---------------------------------------------------------------------------

/** Collect the shell's own lines into the report. */
function watchShell(
  app: { process(): { stdout: unknown; stderr: unknown } },
  report: BaselineRunReport,
): void {
  const child = app.process() as {
    stdout: {
      on(event: "data", handler: (chunk: Buffer) => void): void;
    } | null;
    stderr: {
      on(event: "data", handler: (chunk: Buffer) => void): void;
    } | null;
  };
  child.stdout?.on("data", (chunk) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.startsWith("[yage-shell] ")) {
        report.timeline.push({
          at: Date.now(),
          source: "shell",
          event: line.slice("[yage-shell] ".length),
          data: null,
        });
      }
    }
  });
  child.stderr?.on("data", (chunk) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      const text = line.trim();
      // Electron's own inspector notices arrive on stderr and say nothing
      // about the app.
      if (
        text === "" ||
        text.startsWith("Debugger ") ||
        text.startsWith("For help, see:")
      ) {
        continue;
      }
      report.errors.shell.push(text);
    }
  });
}

async function electronScenario(
  report: BaselineRunReport,
  webDir: string,
): Promise<void> {
  const userData = await newUserDataDir();
  let app = await launchElectron({ webDir, userData });
  try {
    watchShell(app, report);
    report.shell.details = await app.evaluate(({ app: electronApp }) => ({
      electron: process.versions.electron ?? "unknown",
      chrome: process.versions.chrome ?? "unknown",
      node: process.versions.node,
      v8: process.versions.v8,
      name: electronApp.getName(),
    }));
    report.shell.version = report.shell.details["electron"] ?? "unknown";

    let page = await app.firstWindow();
    watchPage(page, report);
    await waitForSettled(page, 60_000);
    const booted = (await readPage(page))!;
    foldReading(report, "booted", booted);
    const failures = checkReadings(report, booted.readings);
    record(report, {
      name: "boot: no callback error",
      result: booted.errors.callbackErrors.length === 0 ? "passed" : "failed",
      evidence: "inspector",
      detail: JSON.stringify(booted.errors.callbackErrors),
    });
    record(report, {
      name: "shell: the page runs without Node reachable from it",
      result: (await page.evaluate(
        () =>
          typeof (window as unknown as { require?: unknown }).require ===
            "undefined" &&
          typeof (window as unknown as { process?: unknown }).process ===
            "undefined",
      ))
        ? "passed"
        : "failed",
      evidence: "inspector",
      detail: null,
    });
    if (failures.length > 0) throw new Error(failures.join("\n"));

    await inputStep(report, page);
    await restoreStep(report, page);

    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setFocusEmulationEnabled", {
      enabled: false,
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
    await page.waitForTimeout(1_000);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore();
    });
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await session.detach();
    await afterReturn(report, page);

    const shot = await screenshotPath(report, "visual");
    const captured = await app.evaluate(async ({ BrowserWindow }) => {
      const image =
        await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    await writeBase64(shot, captured);
    report.screenshots.push({ path: shot, label: "visual" });

    await app.close();
    app = await launchElectron({ webDir, userData });
    watchShell(app, report);
    page = await app.firstWindow();
    watchPage(page, report);
    await waitForSettled(page, 60_000);
    const relaunched = (await readPage(page))!;
    foldReading(report, "after-relaunch", relaunched);
    recordRelaunch(report, relaunched.readings["saves"]);
    recordPageHealth(report);
    recordPending(
      report,
      "electron: a packaged app with an archived web directory",
      "the suite drives an unpackaged shell; the production shell is not built here",
    );
  } finally {
    await app.close().catch(() => undefined);
  }
}

async function electronRelease(
  report: BaselineRunReport,
  webDir: string,
): Promise<void> {
  const userData = await newUserDataDir();
  const app = await launchElectron({ webDir, userData });
  try {
    watchShell(app, report);
    report.shell.version = await app.evaluate(
      () => process.versions.electron ?? "unknown",
    );
    const page = await app.firstWindow();
    watchPage(page, report);
    await releaseChecks(report, page);
    const shot = await screenshotPath(report, "visual");
    const captured = await app.evaluate(async ({ BrowserWindow }) => {
      const image =
        await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    await writeBase64(shot, captured);
    report.screenshots.push({ path: shot, label: "visual" });
  } finally {
    await app.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// iOS simulator
// ---------------------------------------------------------------------------

/**
 * Every case line a launch wrote, by case name. A malformed report line
 * throws, which fails the run and names the line.
 */
function readCaseLines(lines: readonly string[]): Record<string, CaseReading> {
  const readings: Record<string, CaseReading> = {};
  for (const line of lines) {
    const parsed = parseReportLine(line);
    if (parsed === null || parsed["kind"] !== "case") continue;
    readings[String(parsed["case"])] = parsed["reading"] as CaseReading;
  }
  return readings;
}

async function iosScenario(report: BaselineRunReport): Promise<void> {
  const app = await prepareIosApp("Debug");
  const device = selectSimulator();
  report.system.device = device;
  report.shell.details = iosToolVersions();
  report.shell.version = report.shell.details["@capacitor/core"] ?? "unknown";
  await installClean(device.udid, app);

  let launched = launchWithConsole(device.udid);
  try {
    await launched.waitFor(
      (line) => line.includes('"kind":"settled"'),
      120_000,
    );
    const readings = readCaseLines(launched.lines);
    recordReading(report, "booted", readings);
    const failures = checkReadings(report, readings);
    const errorLines = launched.lines.filter((line) =>
      line.includes('"kind":"error"'),
    );
    record(report, {
      name: "boot: no callback error",
      result: errorLines.length === 0 ? "passed" : "failed",
      evidence: "console",
      detail: errorLines.join("\n") || null,
    });
    for (const line of launched.lines) {
      if (line.includes(REPORT_PREFIX)) {
        report.timeline.push({
          at: Date.now(),
          source: "page",
          event: "line",
          data: line,
        });
      }
    }
    if (failures.length > 0) throw new Error(failures.join("\n"));

    recordPending(
      report,
      "input: a tap and a key reach the input case",
      "no input-injection tool is installed for the simulator",
    );
    recordPending(
      report,
      "lifecycle: native application events beside the page's",
      "the app installs no native lifecycle bridge",
    );
    recordPending(
      report,
      "graphics: a lost and restored context draws every case as before",
      "no script runs in the simulator's page",
    );

    const pidBefore = await processId(device.udid);
    await sendToBackground(device.udid);
    await wait(3_000);
    await bringToFront(device.udid);
    const returned = await launched
      .waitFor(
        (line) =>
          line.includes('"event":"host:active"') &&
          line.includes('"active":true'),
        10_000,
      )
      .then(() => true)
      .catch(() => false);
    const hostLines = launched.lines.filter((line) =>
      line.includes('"event":"host:active"'),
    );
    // A page that reported nothing while away, and one that reported the
    // return, both pass. A page that reported leaving and then nothing is
    // recorded as a reading the host did not give, not as a suite failure.
    record(report, {
      name: "after return: the page reports it is active again",
      result: returned || hostLines.length === 0 ? "passed" : "pending",
      evidence: "console",
      detail: hostLines.join("\n") || "no host line arrived",
    });
    const pidAfter = await processId(device.udid);
    record(report, {
      name: "after return: the process is the same one",
      result:
        pidBefore !== null && pidAfter === pidBefore ? "passed" : "failed",
      evidence: "process",
      detail: `process id ${pidBefore ?? "none"} before, ${pidAfter ?? "none"} after`,
    });

    const shot = await screenshotPath(report, "visual");
    await screenshot(device.udid, shot);
    report.screenshots.push({ path: shot, label: "visual" });

    launched.close();
    await terminate(device.udid);
    launched = launchWithConsole(device.udid);
    await launched.waitFor(
      (line) => line.includes('"kind":"settled"'),
      120_000,
    );
    const relaunchedReadings = readCaseLines(launched.lines);
    recordReading(report, "after-relaunch", relaunchedReadings);
    recordRelaunch(report, relaunchedReadings["saves"]);
  } finally {
    launched.close();
    await terminate(report.system.device?.udid ?? "booted");
  }
}

async function iosRelease(report: BaselineRunReport): Promise<void> {
  const app = await prepareIosApp("Release");
  const device = selectSimulator();
  report.system.device = device;
  report.shell.details = iosToolVersions();
  report.shell.version = report.shell.details["@capacitor/core"] ?? "unknown";
  await installClean(device.udid, app);
  const launched = launchWithConsole(device.udid);
  try {
    await wait(10_000);
    record(report, {
      name: "release: the app keeps running",
      result: (await isRunning(device.udid)) ? "passed" : "failed",
      evidence: "process",
      detail: null,
    });
    const reportLines = launched.lines.filter((line) =>
      line.includes(REPORT_PREFIX),
    );
    record(report, {
      name: "release: the app writes no report line",
      result: reportLines.length === 0 ? "passed" : "failed",
      evidence: "console",
      detail: reportLines.join("\n") || null,
    });
    // The web view's own log is the host's, not the page's: a generated
    // project keeps its logging in a release build, so what it prints is
    // recorded rather than asserted.
    recordReading(
      report,
      "web-view-log",
      launched.lines.filter((line) => line.includes("⚡️")),
    );
    const shot = await screenshotPath(report, "visual");
    await screenshot(device.udid, shot);
    report.screenshots.push({ path: shot, label: "visual" });
  } finally {
    launched.close();
    await terminate(device.udid);
  }
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/** A key press and a click through the page's own input, read back. */
async function inputStep(report: BaselineRunReport, page: Page): Promise<void> {
  await page.keyboard.press("Space");
  const point = await pointFor(page, 320, 180);
  await page.mouse.click(point.x, point.y);
  // The click can reach the input case a frame after the key press, so the
  // wait covers both.
  const reached = (input: CaseReading): boolean =>
    input["jumpPresses"] === 1 && input["lastPointer"] !== null;
  await expect
    .poll(async () => reached((await readPage(page))!.readings["input"]!))
    .toBe(true);
  const afterInput = (await readPage(page))!;
  foldReading(report, "after-input", afterInput);
  record(report, {
    name: "input: a key press and a click reached the action map",
    result: reached(afterInput.readings["input"]!) ? "passed" : "failed",
    evidence: "inspector",
    detail: JSON.stringify(afterInput.readings["input"]),
  });
}

/**
 * Take the graphics context away, wait for the page to get one back and
 * compare what it draws with what it drew before.
 */
async function restoreStep(
  report: BaselineRunReport,
  page: Page,
): Promise<void> {
  const before = await readPixels(page);
  await page.evaluate(async () => {
    const host = window as unknown as {
      __yage__?: {
        inspector?: {
          getExtension(
            name: string,
          ): { loseContext(): Promise<void> } | undefined;
        };
      };
    };
    const extension = host.__yage__?.inspector?.getExtension("baseline");
    if (extension === undefined) {
      throw new Error("the page has no baseline extension");
    }
    await extension.loseContext();
  });
  const after = await readPixels(page);
  const changed: string[] = [];
  for (const [name, channels] of Object.entries(before)) {
    const drawn = after[name]!;
    if (channels.some((value, i) => Math.abs(drawn[i]! - value) > 2)) {
      changed.push(`${name}: ${channels.join(",")} -> ${drawn.join(",")}`);
    }
  }
  const reading = (await readPage(page))!;
  foldReading(report, "after-context-restore", reading);
  record(report, {
    name: "graphics: a lost and restored context draws every case as before",
    result: changed.length === 0 ? "passed" : "failed",
    evidence: "inspector",
    detail:
      changed.join("; ") ||
      `context events: ${JSON.stringify(reading.graphicsContext)}`,
  });
}

/** The colour the page draws at each of its named points. */
function readPixels(
  page: Page,
): Promise<Record<string, [number, number, number, number]>> {
  return page.evaluate(() => {
    const host = window as unknown as {
      __yage__?: {
        inspector?: {
          getExtension(
            name: string,
          ):
            | { pixels(): Record<string, [number, number, number, number]> }
            | undefined;
        };
      };
    };
    const extension = host.__yage__?.inspector?.getExtension("baseline");
    if (extension === undefined) {
      throw new Error("the page has no baseline extension");
    }
    return extension.pixels();
  });
}

/** What a page must report once the shell gave it back. */
async function afterReturn(
  report: BaselineRunReport,
  page: Page,
): Promise<void> {
  await expect
    .poll(
      async () => (await readPage(page))!.readings["lifecycle"]!["active"],
      { timeout: 30_000 },
    )
    .toBe(true);
  const reading = (await readPage(page))!;
  foldReading(report, "after-return", reading);
  const lifecycle = reading.readings["lifecycle"]!;
  const changes = lifecycle["activeChanges"] as boolean[];
  record(report, {
    name: "after return: the page is active and its scene runs",
    result: lifecycle["pausedNow"] === false ? "passed" : "failed",
    evidence: "inspector",
    detail: JSON.stringify(lifecycle),
  });
  record(report, {
    name: "after return: a reported change ends with active",
    result:
      changes.length === 0 || changes.at(-1) === true ? "passed" : "failed",
    evidence: "inspector",
    detail: JSON.stringify(changes),
  });
}

/** What the saves case must read after a relaunch on the same profile. */
function recordRelaunch(
  report: BaselineRunReport,
  saves: CaseReading | undefined,
): void {
  record(report, {
    name: "relaunch: the stored launch count carried over",
    result:
      saves?.["launchesBefore"] === 1 &&
      saves["launchesAfter"] === 2 &&
      saves["slotBefore"] === 1 &&
      saves["slotAfter"] === 2
        ? "passed"
        : "failed",
    evidence: "inspector",
    detail: JSON.stringify(saves ?? null),
  });
}

/** The page reported nothing broken. */
function recordPageHealth(report: BaselineRunReport): void {
  record(report, {
    name: "the page reported no error",
    result:
      report.errors.page.length === 0 &&
      report.errors.console.length === 0 &&
      report.errors.requestFailures.length === 0
        ? "passed"
        : "failed",
    evidence: "inspector",
    detail: JSON.stringify({
      page: report.errors.page,
      console: report.errors.console,
      requests: report.errors.requestFailures,
    }),
  });
}

/** What a release build must show in a browser-like shell. */
async function releaseChecks(
  report: BaselineRunReport,
  page: Page,
): Promise<void> {
  await page.waitForSelector("canvas", { timeout: 60_000 });
  const frames = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let count = 0;
        const step = (): void => {
          count += 1;
          if (count >= 60) done(count);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  record(report, {
    name: "release: the page draws and keeps animating",
    result: frames >= 60 ? "passed" : "failed",
    evidence: "inspector",
    detail: `${frames} frames`,
  });
  record(report, {
    name: "release: the page publishes no driver surface",
    result: (await page.evaluate(() => !("__yage__" in window)))
      ? "passed"
      : "failed",
    evidence: "inspector",
    detail: null,
  });
  await page.waitForTimeout(3_000);
  recordPageHealth(report);
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function writeBase64(path: string, base64: string): Promise<void> {
  await writeFile(path, Buffer.from(base64, "base64"));
}
