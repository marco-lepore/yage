import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

/** The cases the fixture mounts, in the order it mounts them. */
const CASE_NAMES = [
  "sprites",
  "text-ui",
  "masks",
  "render-targets",
  "effects",
  "lighting",
  "physics",
  "workers",
  "audio",
  "input",
  "saves",
  "lifecycle",
  "display",
];

interface BaselineReading {
  target: string;
  profile: string;
  bootId: string;
  cases: string[];
  settledCases: string[];
  settled: boolean;
  readings: Record<string, Record<string, unknown>>;
  host: {
    info: { runtime: string; os: string };
    lifecycle: { activity: string; visibility: string; focus: string };
    active: boolean;
  };
  errors: { callbackErrors: unknown[] };
  userAgent: string;
}

interface BaselineExtension {
  read(): BaselineReading;
  pointFor(x: number, y: number): { x: number; y: number };
}

async function openBaseline(page: Page, query = ""): Promise<void> {
  await gotoFixture(page, `/baseline.html${query}`);
  await page.waitForFunction(
    () => window.__yage__?.inspector?.getExtension("baseline") !== undefined,
  );
}

function read(page: Page): Promise<BaselineReading> {
  return page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
      .read(),
  );
}

async function waitForSettled(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector
        ?.getExtension<BaselineExtension>("baseline")
        ?.read().settled === true,
    null,
    { timeout },
  );
}

/** The reading of one case, after it settled. */
async function readCase(
  page: Page,
  name: string,
): Promise<Record<string, unknown>> {
  await openBaseline(page, `?case=${name}`);
  await waitForSettled(page);
  const reading = await read(page);
  expect(reading.cases).toEqual([name]);
  expect(reading.errors.callbackErrors).toEqual([]);
  return reading.readings[name]!;
}

test.describe("baseline fixture", () => {
  test("mounts every case and reports the browser host", async ({ page }) => {
    await openBaseline(page);
    await waitForSettled(page);
    const reading = await read(page);
    expect(reading.cases).toEqual(CASE_NAMES);
    expect(reading.settledCases).toEqual(CASE_NAMES);
    expect(reading.target).toBe("web");
    expect(reading.profile).toBe("test");
    expect(reading.errors.callbackErrors).toEqual([]);
    expect(reading.host.info.runtime).toBe("browser");
    expect(reading.host.info.os).toBe("unknown");
  });

  test("sprites: the texture loaded at its own size", async ({ page }) => {
    const reading = await readCase(page, "sprites");
    expect(reading["textureWidth"]).toBeGreaterThan(0);
    expect(reading["textureHeight"]).toBeGreaterThan(0);
    expect(reading["visible"]).toBe(true);
  });

  test("text-ui: the panel is laid out at its declared width", async ({
    page,
  }) => {
    const reading = await readCase(page, "text-ui");
    expect(reading["textWidth"]).toBeGreaterThan(0);
    expect(reading["panelWidth"]).toBe(200);
    expect(reading["panelHeight"]).toBeGreaterThan(20);
  });

  test("masks: the sprite keeps its mask", async ({ page }) => {
    const reading = await readCase(page, "masks");
    expect(reading["maskAttached"]).toBe(true);
  });

  test("render-targets: the buffer drew at its own size", async ({ page }) => {
    const reading = await readCase(page, "render-targets");
    expect(reading["width"]).toBe(128);
    expect(reading["height"]).toBe(64);
    expect(reading["resolution"]).toBe(reading["rendererResolution"]);
  });

  test("effects: both effects stay attached", async ({ page }) => {
    const reading = await readCase(page, "effects");
    expect(reading["effects"]).toEqual(["yage:outline", "baseline:tint"]);
  });

  test("lighting: the lamp lights its own position", async ({ page }) => {
    const reading = await readCase(page, "lighting");
    expect(reading["levelAtLight"]).toBeGreaterThan(
      reading["levelFar"] as number,
    );
  });

  test("physics: the ball falls and lands", async ({ page }) => {
    const reading = await readCase(page, "physics");
    expect(reading["y"]).toBeGreaterThan(reading["startY"] as number);
    expect(reading["contacts"]).toBeGreaterThanOrEqual(1);
  });

  test("workers: the worker answered", async ({ page }) => {
    const reading = await readCase(page, "workers");
    expect(reading["reply"]).toBe(42);
  });

  test("audio: the registered sound is accepted for playback", async ({
    page,
  }) => {
    const reading = await readCase(page, "audio");
    expect(reading["played"]).toBe(true);
    expect(reading["refusal"]).toBeNull();
  });

  test("input: nothing is pressed before a driver presses it", async ({
    page,
  }) => {
    const reading = await readCase(page, "input");
    expect(reading["jumpPresses"]).toBe(0);
    expect(reading["lastPointer"]).toBeNull();
  });

  test("saves: a fresh profile starts at zero", async ({ page }) => {
    const reading = await readCase(page, "saves");
    expect(reading["launchesBefore"]).toBe(0);
    expect(reading["launchesAfter"]).toBe(1);
    expect(reading["failure"]).toBeNull();
  });

  test("lifecycle: an open page is active and unpaused", async ({ page }) => {
    const reading = await readCase(page, "lifecycle");
    expect(reading["active"]).toBe(true);
    expect(reading["activeChanges"]).toEqual([]);
    expect(reading["pausedNow"]).toBe(false);
  });

  test("display: the renderer reports the screen it drew on", async ({
    page,
  }) => {
    const reading = await readCase(page, "display");
    expect(reading["fullscreenSupport"]).toBe("supported");
    expect(reading["isFullscreen"]).toBe(false);
    expect(reading["orientation"]).toBe("landscape-primary");
    expect(reading["orientationLockSupport"]).toBe("unknown");
    expect(reading["rendererName"]).toBe("webgl");
    expect(reading["glVersion"]).toContain("WebGL");
  });

  test("an unknown case name stops the start", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/baseline.html?case=nope");
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe(
      'Baseline: unknown case "nope". Known cases: ' +
        `${CASE_NAMES.join(", ")}.`,
    );
    expect(await page.evaluate(() => window.__yage__ === undefined)).toBe(true);
  });

  test("the other targets' entries boot too", async ({ page }) => {
    for (const [path, target] of [
      ["/baseline-electron.html", "electron"],
      ["/baseline-capacitor.html", "capacitor"],
    ] as const) {
      await gotoFixture(page, path);
      await page.waitForFunction(
        () =>
          window.__yage__?.inspector?.getExtension("baseline") !== undefined,
      );
      await waitForSettled(page);
      expect((await read(page)).target).toBe(target);
    }
  });
});

test.describe("baseline saves", () => {
  test("each profile starts clean and a reload continues", async ({
    browser,
  }) => {
    const first = await browser.newContext();
    const page = await first.newPage();
    await openBaseline(page, "?case=saves");
    await waitForSettled(page);
    expect((await read(page)).readings["saves"]).toMatchObject({
      launchesBefore: 0,
      launchesAfter: 1,
    });

    await page.reload();
    await page.waitForFunction(
      () => window.__yage__?.inspector?.getExtension("baseline") !== undefined,
    );
    await waitForSettled(page);
    expect((await read(page)).readings["saves"]).toMatchObject({
      launchesBefore: 1,
      launchesAfter: 2,
    });
    await first.close();

    const second = await browser.newContext();
    const fresh = await second.newPage();
    await openBaseline(fresh, "?case=saves");
    await waitForSettled(fresh);
    expect((await read(fresh)).readings["saves"]).toMatchObject({
      launchesBefore: 0,
      launchesAfter: 1,
    });
    await second.close();
  });
});

test.describe("baseline lifecycle", () => {
  /** Give a page a hidden state, which a browser under automation never enters. */
  async function setHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((value) => {
      if (value) {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
      } else {
        delete (document as unknown as Record<string, unknown>)[
          "visibilityState"
        ];
        delete (document as unknown as Record<string, unknown>)["hidden"];
      }
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  }

  test("a hidden page pauses and a visible one resumes", async ({ page }) => {
    await openBaseline(page, "?case=lifecycle");
    await waitForSettled(page);

    await setHidden(page, true);
    await expect
      .poll(async () => (await read(page)).readings["lifecycle"])
      .toMatchObject({
        active: false,
        pausedNow: true,
        activeChanges: [false],
      });

    await setHidden(page, false);
    await expect
      .poll(async () => (await read(page)).readings["lifecycle"])
      .toMatchObject({
        active: true,
        pausedNow: false,
        activeChanges: [false, true],
      });
    const reading = (await read(page)).readings["lifecycle"]!;
    expect(reading["firstFrameAfterResumeMs"]).toBeLessThanOrEqual(100);
  });
});

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`baseline input at device scale factor ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test("a key press and a click reach the action map", async ({ page }) => {
      await openBaseline(page, "?case=input");
      await waitForSettled(page);

      await page.keyboard.press("Space");
      await expect
        .poll(async () => (await read(page)).readings["input"]!["jumpPresses"])
        .toBe(1);

      const point = await page.evaluate(() =>
        window
          .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
          .pointFor(320, 180),
      );
      await page.mouse.click(point.x, point.y);
      await expect
        .poll(async () => (await read(page)).readings["input"]!["lastPointer"])
        .toMatchObject({ type: "mouse" });
      const pointer = (await read(page)).readings["input"]!["lastPointer"] as {
        x: number;
        y: number;
      };
      expect(Math.abs(pointer.x - 320)).toBeLessThanOrEqual(1);
      expect(Math.abs(pointer.y - 180)).toBeLessThanOrEqual(1);
    });

    test("a touch reaches the same reading", async ({ page, context }) => {
      await openBaseline(page, "?case=input");
      await waitForSettled(page);

      const point = await page.evaluate(() =>
        window
          .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
          .pointFor(320, 180),
      );
      const session = await context.newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: point.x, y: point.y }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(async () => (await read(page)).readings["input"]!["lastPointer"])
        .toMatchObject({ type: "touch" });
      const pointer = (await read(page)).readings["input"]!["lastPointer"] as {
        x: number;
        y: number;
      };
      expect(Math.abs(pointer.x - 320)).toBeLessThanOrEqual(1);
      expect(Math.abs(pointer.y - 180)).toBeLessThanOrEqual(1);
      await session.detach();
    });
  });
}
