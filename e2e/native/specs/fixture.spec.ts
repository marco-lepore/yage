import { chromium, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { cp, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildBaseline } from "../lib/build.js";
import { launchElectron, newAppDataDir } from "../lib/electron.js";
import { packWebDir } from "../lib/asar.js";
import { REPORT_PREFIX, parseReportLine } from "../lib/console.js";
import { indexUrl, serveDirectory } from "../lib/server.js";
import { nativeDir, workDir } from "../lib/paths.js";
import {
  appDataDir,
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
import type { LaunchedApp, SimulatorDevice } from "../lib/ios.js";
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
          getExtension(name: string): { read(): BaselineReading } | undefined;
        };
      };
    };
    const extension = host.__yage__?.inspector?.getExtension("baseline");
    return extension?.read() ?? null;
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

/** What the page read, added to the report. */
function addReading(
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
    addReading(report, "booted", booted);
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
    addReading(report, "after-relaunch", relaunched);
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
  const appData = await newAppDataDir();
  const query = "?activeWhenUnfocused=1";
  let app = await launchElectron({
    webDir,
    appData,
    profile: "test",
    query,
  });
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
    const focused = await windowIsFocused(app);
    record(report, {
      name: "shell: the window had focus after launch",
      result: focused ? "passed" : "pending",
      evidence: "harness",
      detail: focused ? null : NO_FOCUS_REASON,
    });
    const booted = (await readPage(page))!;
    addReading(report, "booted", booted);
    const failures = checkReadings(report, booted.readings);
    record(report, {
      name: "boot: no callback error",
      result: booted.errors.callbackErrors.length === 0 ? "passed" : "failed",
      evidence: "inspector",
      detail: JSON.stringify(booted.errors.callbackErrors),
    });
    record(report, {
      name: "boot: the page names the Electron host and the app's version",
      result:
        booted.host.info.runtime === "electron" &&
        booted.host.info.os === "macos" &&
        booted.policy.stringEvaluation === false
          ? "passed"
          : "failed",
      evidence: "inspector",
      detail: JSON.stringify({
        host: booted.host.info,
        policy: booted.policy,
      }),
    });
    await recordBridge(report, page, appData);
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
    await expect
      .poll(async () => (await readPage(page))!.host.lifecycle.visibility, {
        timeout: 15_000,
      })
      .toBe("hidden");
    record(report, {
      name: "background: a minimised window reports the page hidden",
      result: "passed",
      evidence: "inspector",
      detail: JSON.stringify((await readPage(page))!.host.lifecycle),
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore();
    });
    await expect
      .poll(async () => (await readPage(page))!.host.lifecycle.visibility, {
        timeout: 15_000,
      })
      .toBe("visible");
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await session.detach();
    await afterReturn(report, page);
    await recordFocus(report, app, page, focused);
    await recordFullscreen(report, app, page, focused);

    const shot = await screenshotPath(report, "visual");
    const captured = await app.evaluate(async ({ BrowserWindow }) => {
      const image =
        await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    await writeBase64(shot, captured);
    report.screenshots.push({ path: shot, label: "visual" });

    await app.close();
    await recordSaveFiles(report, appData);
    app = await launchElectron({ webDir, appData, profile: "test", query });
    watchShell(app, report);
    page = await app.firstWindow();
    watchPage(page, report);
    await waitForSettled(page, 60_000);
    const relaunched = (await readPage(page))!;
    addReading(report, "after-relaunch", relaunched);
    recordRelaunch(report, relaunched.readings["saves"]);
    recordPageHealth(report);
    await recordQuit(report, app, page);
  } finally {
    await app.close().catch(() => undefined);
  }
  await recordRename(report, webDir, appData, query);
  await recordArchive(report, webDir);
  await recordKillTest(report, webDir);
}

async function electronRelease(
  report: BaselineRunReport,
  webDir: string,
): Promise<void> {
  const appData = await newAppDataDir();
  const app = await launchElectron({ webDir, appData, profile: "release" });
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
    await recordReleaseShell(report, app);
  } finally {
    await app.close().catch(() => undefined);
  }
}

/** Why a check that needs the window in front could not run. */
const NO_FOCUS_REASON =
  "the window never received focus: macOS kept another app or the lock " +
  "screen in front";

/** Whether the game window holds the keyboard focus. */
function windowIsFocused(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.isFocused() === true,
  );
}

/** The page's own view of the bridge, and what it refuses. */
async function recordBridge(
  report: BaselineRunReport,
  page: Page,
  appData: string,
): Promise<void> {
  const bridge = await page.evaluate(() => {
    const exposed = (
      window as unknown as { __yageHost__?: { protocol: number } }
    ).__yageHost__;
    return {
      protocol: exposed?.protocol ?? null,
      frozen: exposed !== undefined && Object.isFrozen(exposed),
    };
  });
  record(report, {
    name: "bridge: the page sees one frozen object at protocol 1",
    result: bridge.protocol === 1 && bridge.frozen ? "passed" : "failed",
    evidence: "inspector",
    detail: JSON.stringify(bridge),
  });

  const before = await saveFileNames(appData);
  const refusals = await page.evaluate(async () => {
    const host = (
      window as unknown as {
        __yageHost__: {
          saves: { write(key: unknown, value: unknown): Promise<void> };
          setFullscreen(active: unknown): Promise<unknown>;
        };
      }
    ).__yageHost__;
    const refusal = async (call: () => Promise<unknown>): Promise<string> => {
      try {
        await call();
        return "resolved";
      } catch (error) {
        return (error as Error).message;
      }
    };
    return {
      numericKey: await refusal(() => host.saves.write(42, "x")),
      numericValue: await refusal(() => host.saves.write("k", 7)),
      stringFullscreen: await refusal(() => host.setFullscreen("yes")),
    };
  });
  const refused =
    refusals.numericKey.includes("key must be a string, got number.") &&
    refusals.numericValue.includes("value must be a string, got number.") &&
    refusals.stringFullscreen.includes('active must be a boolean, got "yes".');
  const after = await saveFileNames(appData);
  record(report, {
    name: "bridge: an argument of the wrong kind reaches no native operation",
    result: refused && after.join() === before.join() ? "passed" : "failed",
    evidence: "inspector",
    detail: JSON.stringify({ refusals, before, after }),
  });
}

/** The save directory the shell writes, and the files in it. */
function saveDir(appData: string): string {
  return resolve(appData, "dev.yage.baseline/saves/test");
}

async function saveFileNames(appData: string): Promise<string[]> {
  const directory = saveDir(appData);
  if (!existsSync(directory)) return [];
  return (await readdir(directory)).sort();
}

/** What the save directory holds once the first launch closed. */
async function recordSaveFiles(
  report: BaselineRunReport,
  appData: string,
): Promise<void> {
  const names = await saveFileNames(appData);
  record(report, {
    name: "saves: the app data directory holds one finished file per key",
    result:
      names.length > 0 &&
      names.every((name) => name.endsWith(".sav")) &&
      names.every((name) => name.startsWith("k-"))
        ? "passed"
        : "failed",
    evidence: "file",
    detail: JSON.stringify(names),
  });
}

/** Focus moving away from the game window and back. */
async function recordFocus(
  report: BaselineRunReport,
  app: ElectronApplication,
  page: Page,
  focused: boolean,
): Promise<void> {
  if (!focused) {
    recordPending(
      report,
      "focus: another window in front reports the game unfocused",
      NO_FOCUS_REASON,
    );
    return;
  }
  await app.evaluate(({ BrowserWindow }) => {
    const second = new BrowserWindow({ width: 320, height: 240 });
    second.focus();
  });
  await expect
    .poll(async () => (await readPage(page))!.host.lifecycle.focus, {
      timeout: 15_000,
    })
    .toBe("unfocused");
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    windows[windows.length - 1]?.close();
    windows[0]?.focus();
  });
  await expect
    .poll(async () => (await readPage(page))!.host.lifecycle.focus, {
      timeout: 15_000,
    })
    .toBe("focused");
  record(report, {
    name: "focus: another window in front reports the game unfocused",
    result: "passed",
    evidence: "inspector",
    detail: null,
  });
}

/** The window's fullscreen, asked for through the renderer. */
async function recordFullscreen(
  report: BaselineRunReport,
  app: ElectronApplication,
  page: Page,
  focused: boolean,
): Promise<void> {
  const outcome = await page.evaluate(async () => {
    const extension = (
      window as unknown as {
        __yage__: {
          inspector: {
            getExtension(name: string): {
              fullscreen(active: boolean): Promise<{ outcome: string }>;
            };
          };
        };
      }
    ).__yage__.inspector.getExtension("baseline");
    return extension.fullscreen(true);
  });
  const inFullscreen = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.isFullScreen() === true,
  );
  const reading = (await readPage(page))!.readings["display"]!;
  const detail = JSON.stringify({
    outcome,
    window: inFullscreen,
    reading,
  });
  if (!focused) {
    recordPending(
      report,
      "fullscreen: a request through the renderer moves the window",
      `${NO_FOCUS_REASON}; the request settled as ${detail}`,
    );
  } else {
    record(report, {
      name: "fullscreen: a request through the renderer moves the window",
      result:
        outcome.outcome === "resolved" &&
        inFullscreen &&
        reading["isFullscreen"] === true &&
        (reading["fullscreenEvents"] as boolean[]).at(-1) === true
          ? "passed"
          : "failed",
      evidence: "inspector",
      detail,
    });
  }

  // However the request ended, the page and the window agree, and a change
  // the main process makes reaches the page.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setFullScreen(false);
  });
  await expect
    .poll(
      async () => (await readPage(page))!.readings["display"]!["isFullscreen"],
      { timeout: 15_000 },
    )
    .toBe(false);
  record(report, {
    name: "fullscreen: the page follows a change the shell made",
    result: "passed",
    evidence: "inspector",
    detail: JSON.stringify((await readPage(page))!.readings["display"]),
  });
}

/** Closing the window from the page ends the app. */
async function recordQuit(
  report: BaselineRunReport,
  app: ElectronApplication,
  page: Page,
): Promise<void> {
  const closed = app.waitForEvent("close", { timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  await page.evaluate(() => window.close());
  record(report, {
    name: "quit: the page closing its window ends the app",
    result: (await closed) ? "passed" : "failed",
    evidence: "process",
    detail: null,
  });
}

/** A copy of the shell under another app name reads the same saves. */
async function recordRename(
  report: BaselineRunReport,
  webDir: string,
  appData: string,
  query: string,
): Promise<void> {
  const renamed = resolve(workDir, "electron-renamed");
  await cp(resolve(nativeDir, "electron"), renamed, { recursive: true });
  await writeFile(
    resolve(renamed, "package.json"),
    `${JSON.stringify(
      {
        name: "yage-baseline-electron-shell",
        productName: "YAGE Baseline Renamed",
        private: true,
        version: "0.0.0",
        main: "main.cjs",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const app = await launchElectron({
    webDir,
    appData,
    profile: "test",
    query,
    shellDir: renamed,
  });
  try {
    watchShell(app, report);
    const name = await app.evaluate(({ app: electronApp }) =>
      electronApp.getName(),
    );
    const page = await app.firstWindow();
    watchPage(page, report);
    await waitForSettled(page, 60_000);
    const saves = (await readPage(page))!.readings["saves"]!;
    record(report, {
      name: "rename: an app under a new name reads the saves it wrote",
      result:
        name === "YAGE Baseline Renamed" && Number(saves["launchesBefore"]) >= 2
          ? "passed"
          : "failed",
      evidence: "inspector",
      detail: JSON.stringify({ name, saves }),
    });
  } finally {
    await app.close().catch(() => undefined);
  }
}

/** The same build, served from inside an archive. */
async function recordArchive(
  report: BaselineRunReport,
  webDir: string,
): Promise<void> {
  const archive = await packWebDir(webDir);
  const appData = await newAppDataDir();
  const app = await launchElectron({
    webDir: archive,
    appData,
    profile: "test",
    query: "?activeWhenUnfocused=1",
  });
  try {
    watchShell(app, report);
    const page = await app.firstWindow();
    watchPage(page, report);
    await waitForSettled(page, 60_000);
    const reading = (await readPage(page))!;
    addReading(report, "archive", reading);
    const failures = checkReadings(report, reading.readings);
    record(report, {
      name: "archive: every case settles from inside the packed web directory",
      result:
        failures.length === 0 && reading.errors.callbackErrors.length === 0
          ? "passed"
          : "failed",
      evidence: "inspector",
      detail: JSON.stringify(failures),
    });
  } finally {
    await app.close().catch(() => undefined);
  }
}

/** How many rounds the kill test runs, and the window it kills in. */
const KILL_ROUNDS = 20;
const KILL_EARLIEST_MS = 150;
const KILL_LATEST_MS = 750;

/** The kill test's check name in a report, for every shell. */
const KILL_CHECK = "kill: a relaunch reads the last acknowledged save";

/** The last write acknowledged before a kill, and what the next launch read. */
interface KillRound {
  acknowledged: number | null;
  found: number | null;
}

/**
 * Record the kill test's verdict: each launch reads the write acknowledged
 * before the previous kill or the one after it, and no save when none was
 * acknowledged.
 */
function recordKillRounds(
  report: BaselineRunReport,
  rounds: readonly KillRound[],
): void {
  const carried = rounds.slice(1).every((round, index) => {
    const before = rounds[index]!.acknowledged;
    if (before === null) return round.found === null;
    return round.found === before || round.found === before + 1;
  });
  record(report, {
    name: KILL_CHECK,
    result: carried ? "passed" : "failed",
    evidence: "console",
    detail: JSON.stringify(rounds),
  });
}

/**
 * Kill the main process in the middle of a stream of saves, over and over,
 * and check that the relaunch reads the last write the storage acknowledged
 * or the one after it, never a damaged document.
 */
async function recordKillTest(
  report: BaselineRunReport,
  webDir: string,
): Promise<void> {
  const appData = await newAppDataDir();
  const rounds: KillRound[] = [];
  for (let round = 0; round < KILL_ROUNDS; round += 1) {
    const app = await launchElectron({
      webDir,
      appData,
      profile: "test",
      query: "?case=saves&activeWhenUnfocused=1&writeLoop=1",
    });
    let acknowledged: number | null = null;
    let found: number | null = null;
    let failure: string | null = null;
    const page = await app.firstWindow();
    let first: (() => void) | null = null;
    const sawFirstWrite = new Promise<void>((done) => {
      first = done;
    });
    page.on("console", (message) => {
      const line = parseReportLine(message.text());
      if (line === null) return;
      if (line["kind"] === "loop-start") {
        found = line["found"] as number | null;
        failure = line["error"] as string | null;
      }
      if (line["kind"] === "write") {
        acknowledged = line["n"] as number;
        first?.();
      }
    });
    await sawFirstWrite;
    await new Promise((done) =>
      setTimeout(
        done,
        KILL_EARLIEST_MS +
          Math.floor(Math.random() * (KILL_LATEST_MS - KILL_EARLIEST_MS)),
      ),
    );
    const killed = acknowledged;
    app.process().kill("SIGKILL");
    await app.waitForEvent("close").catch(() => undefined);
    rounds.push({ acknowledged: killed, found });
    if (failure !== null) {
      record(report, {
        name: KILL_CHECK,
        result: "failed",
        evidence: "console",
        detail: `round ${round}: ${failure}`,
      });
      return;
    }
  }
  recordKillRounds(report, rounds);
}

/** What a release build must not offer the player. */
async function recordReleaseShell(
  report: BaselineRunReport,
  app: ElectronApplication,
): Promise<void> {
  const shell = await app.evaluate(async ({ BrowserWindow, Menu }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.webContents.openDevTools();
    await new Promise((done) => setTimeout(done, 500));
    const roles = (Menu.getApplicationMenu()?.items ?? []).flatMap((item) =>
      (item.submenu?.items ?? []).map((entry) => entry.role ?? ""),
    );
    return { devTools: win.webContents.isDevToolsOpened(), roles };
  });
  record(report, {
    name: "release: the player reaches no developer tools",
    result:
      !shell.devTools &&
      !shell.roles.some((role) =>
        ["reload", "forcereload", "toggledevtools"].includes(
          role.toLowerCase(),
        ),
      )
        ? "passed"
        : "failed",
    evidence: "inspector",
    detail: JSON.stringify(shell),
  });
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
    recordAppIdentity(report, launched.lines);
    const display = readings["display"];
    record(report, {
      name: "display: the app supplies the orientation lock",
      result:
        display?.["orientationLockSupport"] === "supported"
          ? "passed"
          : "failed",
      evidence: "console",
      detail: JSON.stringify(display ?? null),
    });
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
      "graphics: a lost and restored context draws every case as before",
      "no script runs in the simulator's page",
    );

    const pidBefore = await processId(device.udid);
    const beforeTrip = launched.lines.length;
    await sendToBackground(device.udid);
    await wait(3_000);
    const awayLines = lifecycleLines(launched.lines.slice(beforeTrip));
    record(report, {
      name: "away: the app reports it is inactive and hidden",
      result:
        awayLines.some((line) => line.activity === "inactive") &&
        awayLines.some((line) => line.visibility === "hidden")
          ? "passed"
          : "failed",
      evidence: "console",
      detail: JSON.stringify(awayLines),
    });
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
    // The app states it is active again a moment after the window is back,
    // and each line reaches this process through the simulator's console.
    const backLines = await waitForLifecycle(
      launched,
      beforeTrip,
      (state) =>
        state.activity === "active" &&
        state.visibility === "visible" &&
        state.focus === "focused",
      10_000,
    );
    const last = backLines.at(-1);
    record(report, {
      name: "after return: the app reports it is active, visible and focused",
      result:
        last?.activity === "active" &&
        last.visibility === "visible" &&
        last.focus === "focused"
          ? "passed"
          : "failed",
      evidence: "console",
      detail: JSON.stringify(backLines),
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
    await recordIosSaveFiles(report, device.udid);
  } finally {
    launched.close();
    await terminate(report.system.device?.udid ?? "booted");
  }
  await recordOrientationLock(report, device);
  await recordIosKillTest(report, device);
}

/** The app's identity, as the boot line read it from the host. */
function recordAppIdentity(
  report: BaselineRunReport,
  lines: readonly string[],
): void {
  let info: unknown = null;
  for (const line of lines) {
    const parsed = parseReportLine(line);
    if (parsed === null || parsed["kind"] !== "boot") continue;
    info = (parsed["host"] as { info?: unknown } | undefined)?.info ?? null;
  }
  record(report, {
    name: "boot: the app states its runtime, system and version",
    result:
      JSON.stringify(info) ===
      JSON.stringify({
        runtime: "capacitor",
        os: "ios",
        appVersion: "1.0",
        appBuild: "1",
        runtimeVersion: null,
      })
        ? "passed"
        : "failed",
    evidence: "console",
    detail: JSON.stringify(info),
  });
}

/** What one `host:lifecycle` line reported. */
interface LifecycleLine {
  activity: string;
  visibility: string;
  focus: string;
}

/** The lifecycle each `host:lifecycle` line among these reported. */
function lifecycleLines(lines: readonly string[]): LifecycleLine[] {
  const reported: LifecycleLine[] = [];
  for (const line of lines) {
    const parsed = parseReportLine(line);
    if (parsed === null || parsed["event"] !== "host:lifecycle") continue;
    const payload = parsed["payload"] as { lifecycle: LifecycleLine };
    reported.push(payload.lifecycle);
  }
  return reported;
}

/** Read the lifecycle lines since `from` until the app settles, or give up. */
async function waitForLifecycle(
  launched: LaunchedApp,
  from: number,
  settled: (state: LifecycleLine) => boolean,
  timeoutMs: number,
): Promise<LifecycleLine[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = lifecycleLines(launched.lines.slice(from));
    const last = lines.at(-1);
    if ((last !== undefined && settled(last)) || Date.now() > deadline) {
      return lines;
    }
    await wait(100);
  }
}

/** The files the saves case left in the app's own directory. */
async function recordIosSaveFiles(
  report: BaselineRunReport,
  udid: string,
): Promise<void> {
  const dir = resolve(await appDataDir(udid), "Library/yage-saves/test");
  const names = await readdir(dir).catch(() => [] as string[]);
  record(report, {
    name: "saves: the slots are files in the app's own directory",
    result:
      names.some((name) => /^k-.+\.sav$/.test(name)) &&
      !names.some((name) => name.endsWith(".new"))
        ? "passed"
        : "failed",
    evidence: "file",
    detail: JSON.stringify(names),
  });
}

/** Build the Capacitor page with launch flags in it, and install the app. */
async function installWithFlags(
  device: SimulatorDevice,
  query: string,
): Promise<void> {
  await buildBaseline("capacitor", "test", { query });
  const app = await prepareIosApp("Debug");
  await installClean(device.udid, app);
}

/**
 * The bound the host adapter settles an orientation lock at. A lock that
 * turned the screen resolves well before it.
 */
const ORIENTATION_BOUND_MS = 2000;

/** Lock the screen through the renderer and read what the app answered. */
async function recordOrientationLock(
  report: BaselineRunReport,
  device: SimulatorDevice,
): Promise<void> {
  await installWithFlags(device, "?case=display&lockOrientation=landscape");
  const launched = launchWithConsole(device.udid);
  try {
    const locked = parseReportLine(
      await launched.waitFor(
        (line) => line.includes('"kind":"orientation"'),
        120_000,
      ),
    );
    const result = String(locked?.["result"]);
    const ms = Number(locked?.["ms"]);
    const released = await launched
      .waitFor((line) => line.includes('"kind":"orientation-unlocked"'), 30_000)
      .then(() => true)
      .catch(() => false);
    record(report, {
      name: "orientation: the lock settles at the turned screen",
      result:
        result.startsWith("landscape") && ms < ORIENTATION_BOUND_MS && released
          ? "passed"
          : "failed",
      evidence: "console",
      detail: JSON.stringify({ ...locked, released }),
    });
  } finally {
    launched.close();
    await terminate(device.udid);
  }
}

/** How long the simulator's console takes to deliver what a dead app wrote. */
const CONSOLE_DRAIN_MS = 1000;

/**
 * Stop the app in the middle of a stream of saves, over and over, and check
 * that the next launch reads the last write the storage acknowledged or the
 * one after it, never a damaged document.
 */
async function recordIosKillTest(
  report: BaselineRunReport,
  device: SimulatorDevice,
): Promise<void> {
  await installWithFlags(device, "?case=saves&writeLoop=1");
  const rounds: KillRound[] = [];
  for (let round = 0; round < KILL_ROUNDS; round += 1) {
    const launched = launchWithConsole(device.udid);
    let failure: string | null = null;
    try {
      const started = parseReportLine(
        await launched.waitFor(
          (line) => line.includes('"kind":"loop-start"'),
          120_000,
        ),
      );
      failure = (started?.["error"] as string | null) ?? null;
      const found = (started?.["found"] as number | null) ?? null;
      await launched.waitFor((line) => line.includes('"kind":"write"'), 60_000);
      await wait(
        KILL_EARLIEST_MS +
          Math.floor(Math.random() * (KILL_LATEST_MS - KILL_EARLIEST_MS)),
      );
      await terminate(device.udid);
      // The app writes until it is gone and its console reaches this process
      // behind the writes, so the last write is read once both have ended.
      await wait(CONSOLE_DRAIN_MS);
      rounds.push({ acknowledged: lastWrite(launched.lines), found });
    } finally {
      await terminate(device.udid);
      launched.close();
    }
    if (failure !== null) {
      record(report, {
        name: KILL_CHECK,
        result: "failed",
        evidence: "console",
        detail: `round ${round}: ${failure}`,
      });
      return;
    }
  }
  recordKillRounds(report, rounds);
}

/** The counter of the last write the storage acknowledged. */
function lastWrite(lines: readonly string[]): number | null {
  let last: number | null = null;
  for (const line of lines) {
    const parsed = parseReportLine(line);
    if (parsed === null || parsed["kind"] !== "write") continue;
    last = parsed["n"] as number;
  }
  return last;
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
  addReading(report, "after-input", afterInput);
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
  addReading(report, "after-context-restore", reading);
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
  addReading(report, "after-return", reading);
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
