import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { webDirFor } from "../lib/build.js";
import { launchElectron, newAppDataDir } from "../lib/electron.js";
import { indexUrl, serveDirectory } from "../lib/server.js";
import {
  installClean,
  iosToolVersions,
  isRunning,
  launchWithConsole,
  prepareIosApp,
  screenshot,
  selectSimulator,
  terminate,
} from "../lib/ios.js";
import { writeReport } from "../lib/report.js";
import type { BaselineRunReport, ReportTarget } from "../lib/report.js";
import {
  finishReport,
  record,
  recordPending,
  recordReading,
  screenshotPath,
  startReport,
} from "../lib/run.js";

/**
 * A built game's web directory, which a preparation run produced. Without it
 * there is no game to check, and the test is skipped.
 */
const webDir = process.env["BASELINE_WEB"];
const query = process.env["BASELINE_QUERY"] ?? "";
const provenancePath = process.env["BASELINE_PROVENANCE"];

function targetOf(name: string): ReportTarget {
  if (name === "browser" || name === "electron" || name === "ios-simulator") {
    return name;
  }
  throw new Error(
    `game.spec: the project ${JSON.stringify(name)} has no shell.`,
  );
}

/** What a game's own page reports through the Inspector. */
async function readGame(page: Page): Promise<{
  scenes: string[];
  callbackErrors: unknown[];
} | null> {
  return page.evaluate(() => {
    const host = window as unknown as {
      __yage__?: {
        inspector?: {
          getSceneStack(): { name: string }[];
          getErrors(): { callbackErrors: unknown[] };
        };
      };
    };
    const inspector = host.__yage__?.inspector;
    if (inspector === undefined) return null;
    return {
      scenes: inspector.getSceneStack().map((scene) => scene.name),
      callbackErrors: inspector.getErrors().callbackErrors,
    } as never;
  });
}

function watchPage(page: Page, report: BaselineRunReport): void {
  page.on("pageerror", (error) => report.errors.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.console.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.errors.requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    }),
  );
}

function readStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => ({ ...localStorage }) as never);
}

function recordHealth(report: BaselineRunReport): void {
  record(report, {
    name: "the game reported no error",
    result:
      report.errors.page.length === 0 &&
      report.errors.console.length === 0 &&
      report.errors.requestFailures.length === 0 &&
      report.errors.callback.length === 0
        ? "passed"
        : "failed",
    evidence: "inspector",
    detail: JSON.stringify(report.errors),
  });
}

test.describe("a prepared game", () => {
  test.skip(
    webDir === undefined,
    "set BASELINE_WEB to a built game's web directory",
  );

  test("boots and keeps what it stored", async ({}, testInfo) => {
    const target = targetOf(testInfo.project.name);
    const built = webDir!;
    const report = await startReport(target, "test", built);
    report.subject = {
      kind: "game",
      label: built.split("/").at(-1) ?? built,
      provenance: provenancePath ?? "none recorded",
    };
    if (provenancePath !== undefined && existsSync(provenancePath)) {
      recordReading(
        report,
        "provenance",
        JSON.parse(readFileSync(provenancePath, "utf8")),
      );
    }
    let failure: unknown = null;
    try {
      if (target === "browser") await browserGame(report, built);
      else if (target === "electron") await electronGame(report, built);
      else await iosGame(report, built);
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

/** What a game must show in a browser-like shell. */
async function checkGamePage(
  report: BaselineRunReport,
  page: Page,
): Promise<void> {
  // The polled value names how far the page got, so a timeout says whether
  // the game published no Inspector or published one with no scene.
  await expect
    .poll(
      async () => {
        const game = await readGame(page);
        if (game === null) {
          return (
            "the page published no Inspector at window.__yage__.inspector; " +
            "build the game with debug on and an Inspector installed"
          );
        }
        return game.scenes.length > 0
          ? "a scene is running"
          : "the Inspector is published and the scene stack is empty";
      },
      { timeout: 60_000 },
    )
    .toBe("a scene is running");
  const reading = (await readGame(page))!;
  recordReading(report, "booted", reading);
  report.errors.callback = reading.callbackErrors;
  record(report, {
    name: "the game reached a scene",
    result: reading.scenes.length > 0 ? "passed" : "failed",
    evidence: "inspector",
    detail: reading.scenes.join(", "),
  });
}

async function browserGame(
  report: BaselineRunReport,
  built: string,
): Promise<void> {
  const served = await serveDirectory(built);
  const browser = await chromium.launch();
  report.shell.version = browser.version();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    watchPage(page, report);
    await page.goto(indexUrl(served, query));
    await checkGamePage(report, page);
    const stored = await readStorage(page);
    await page.screenshot({ path: await screenshotPath(report, "visual") });
    report.screenshots.push({
      path: await screenshotPath(report, "visual"),
      label: "visual",
    });
    await page.reload();
    await checkGamePage(report, page);
    recordCarryOver(report, stored, await readStorage(page));
    recordHealth(report);
  } finally {
    await context.close();
    await browser.close();
    await served.close();
  }
}

async function electronGame(
  report: BaselineRunReport,
  built: string,
): Promise<void> {
  const appData = await newAppDataDir();
  let app = await launchElectron({
    webDir: built,
    appData,
    profile: "test",
    query,
  });
  try {
    report.shell.version = await app.evaluate(
      () => process.versions.electron ?? "unknown",
    );
    let page = await app.firstWindow();
    watchPage(page, report);
    await checkGamePage(report, page);
    const stored = await readStorage(page);
    const shot = await screenshotPath(report, "visual");
    const captured = await app.evaluate(async ({ BrowserWindow }) => {
      const image =
        await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(shot, Buffer.from(captured, "base64"));
    report.screenshots.push({ path: shot, label: "visual" });

    await app.close();
    app = await launchElectron({
      webDir: built,
      appData,
      profile: "test",
      query,
    });
    page = await app.firstWindow();
    watchPage(page, report);
    await checkGamePage(report, page);
    recordCarryOver(report, stored, await readStorage(page));
    recordHealth(report);
  } finally {
    await app.close().catch(() => undefined);
  }
}

async function iosGame(
  report: BaselineRunReport,
  built: string,
): Promise<void> {
  // The generated project loads one web directory, so the game's build takes
  // that slot for this run.
  const slot = webDirFor("capacitor", "test");
  rmSync(slot, { recursive: true, force: true });
  cpSync(built, slot, { recursive: true });
  const app = await prepareIosApp("Debug");
  const device = selectSimulator();
  report.system.device = device;
  report.shell.details = iosToolVersions();
  report.shell.version = report.shell.details["@capacitor/core"] ?? "unknown";
  await installClean(device.udid, app);
  let launched = launchWithConsole(device.udid);
  try {
    await launched.waitFor((line) => line.includes("WebView loaded"), 120_000);
    await wait(20_000);
    const errorLines = launched.lines.filter((line) =>
      line.includes("[error]"),
    );
    record(report, {
      name: "the game's web view logged no error",
      result: errorLines.length === 0 ? "passed" : "failed",
      evidence: "console",
      detail: errorLines.join("\n") || null,
    });
    record(report, {
      name: "the game keeps running",
      result: (await isRunning(device.udid)) ? "passed" : "failed",
      evidence: "process",
      detail: null,
    });
    const shot = await screenshotPath(report, "visual");
    await screenshot(device.udid, shot);
    report.screenshots.push({ path: shot, label: "visual" });

    launched.close();
    await terminate(device.udid);
    launched = launchWithConsole(device.udid);
    await launched.waitFor((line) => line.includes("WebView loaded"), 120_000);
    record(report, {
      name: "relaunch: the game loads again",
      result: (await isRunning(device.udid)) ? "passed" : "failed",
      evidence: "process",
      detail: null,
    });
    const relaunchShot = await screenshotPath(report, "relaunch");
    await screenshot(device.udid, relaunchShot);
    report.screenshots.push({ path: relaunchShot, label: "visual" });
  } finally {
    launched.close();
    await terminate(device.udid);
  }
}

/**
 * Whether what the game stored before a relaunch is still there after it. A
 * game that stored nothing gives nothing to compare, so the check is pending.
 */
function recordCarryOver(
  report: BaselineRunReport,
  before: Record<string, string>,
  after: Record<string, string>,
): void {
  const keys = Object.keys(before);
  if (keys.length === 0) {
    recordPending(
      report,
      "relaunch: the stored keys carried over",
      "the game stored nothing before the relaunch",
    );
    return;
  }
  record(report, {
    name: "relaunch: the stored keys carried over",
    result: keys.every((key) => after[key] === before[key])
      ? "passed"
      : "failed",
    evidence: "inspector",
    detail: keys.join(", "),
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
