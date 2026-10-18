import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

interface LifecycleReading {
  activity: string;
  visibility: string;
  focus: string;
  active: boolean;
  activeWhenUnfocused: boolean;
  paused: boolean;
  updates: number;
  pauses: number;
  resumes: number;
  frame: number;
  jumpHeld: boolean;
  stack: string[];
  overlayPauses: number;
  overlayResumes: number;
}

interface LifecycleExtension {
  first(): LifecycleReading;
  secondPaused(): boolean | null;
  setManualPause(paused: boolean): void;
  pushOverlay(): Promise<void>;
  setActiveWhenUnfocused(value: boolean): void;
  report(state: {
    activity?: string;
    visibility?: string;
    focus?: string;
  }): void;
  destroySecond(): void;
}

async function openFixture(page: Page): Promise<void> {
  await gotoFixture(page, "/host-lifecycle.html");
  await page.waitForFunction(
    () => window.__yage__?.inspector?.getExtension("lifecycle") !== undefined,
  );
}

function read(page: Page): Promise<LifecycleReading> {
  return page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<LifecycleExtension>("lifecycle")!
      .first(),
  );
}

function secondPaused(page: Page): Promise<boolean | null> {
  return page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<LifecycleExtension>("lifecycle")!
      .secondPaused(),
  );
}

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

function dispatchWindowEvent(page: Page, type: string): Promise<void> {
  return page.evaluate(
    (name) => void window.dispatchEvent(new Event(name)),
    type,
  );
}

/** Wait until the loop has advanced past `frame`. */
async function waitForFrameAfter(page: Page, frame: number): Promise<void> {
  await page.waitForFunction(
    (baseline) =>
      window
        .__yage__!.inspector.getExtension<{
          first(): { frame: number };
        }>("lifecycle")!
        .first().frame > baseline,
    frame,
  );
}

/** Wait until the play scene's component has run past `updates`. */
async function waitForUpdateAfter(page: Page, updates: number): Promise<void> {
  await page.waitForFunction(
    (baseline) =>
      window
        .__yage__!.inspector.getExtension<{
          first(): { updates: number };
        }>("lifecycle")!
        .first().updates > baseline,
    updates,
  );
}

test.describe("host lifecycle", () => {
  test("a fresh page reports a visible, focused and active host", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await read(page)).toMatchObject({
      activity: "unknown",
      visibility: "visible",
      focus: "focused",
      active: true,
      activeWhenUnfocused: false,
      paused: false,
    });
  });

  test("a hidden page pauses the scene while the loop keeps running", async ({
    page,
  }) => {
    await openFixture(page);
    await waitForFrameAfter(page, (await read(page)).frame);

    await setHidden(page, true);
    const paused = await read(page);
    expect(paused).toMatchObject({
      visibility: "hidden",
      active: false,
      paused: true,
      pauses: 1,
      resumes: 0,
    });

    // A repeated event is one more report of the same state, so no hook runs.
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await waitForFrameAfter(page, paused.frame);
    const still = await read(page);
    expect(still.pauses).toBe(1);
    expect(still.updates).toBe(paused.updates);
    expect(still.frame).toBeGreaterThan(paused.frame);

    await setHidden(page, false);
    const resumed = await read(page);
    expect(resumed).toMatchObject({
      visibility: "visible",
      active: true,
      paused: false,
      resumes: 1,
    });
    await waitForUpdateAfter(page, resumed.updates);
  });

  test("an unfocused window releases held input and pauses the scene", async ({
    page,
  }) => {
    await openFixture(page);
    await page.keyboard.down("Space");
    await waitForFrameAfter(page, (await read(page)).frame);
    expect((await read(page)).jumpHeld).toBe(true);

    await dispatchWindowEvent(page, "blur");

    expect(await read(page)).toMatchObject({
      focus: "unfocused",
      visibility: "visible",
      active: false,
      paused: true,
      jumpHeld: false,
    });

    await dispatchWindowEvent(page, "focus");
    expect(await read(page)).toMatchObject({
      focus: "focused",
      active: true,
      paused: false,
      pauses: 1,
      resumes: 1,
    });
    await page.keyboard.up("Space");
  });

  test("an unfocused window keeps updating when the setting says so", async ({
    page,
  }) => {
    await openFixture(page);
    await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<LifecycleExtension>("lifecycle")!
        .setActiveWhenUnfocused(true),
    );
    await page.keyboard.down("Space");
    await waitForFrameAfter(page, (await read(page)).frame);

    await dispatchWindowEvent(page, "blur");

    const after = await read(page);
    expect(after).toMatchObject({
      focus: "unfocused",
      active: true,
      paused: false,
      jumpHeld: false,
      pauses: 0,
    });
    await waitForUpdateAfter(page, after.updates);
    await page.keyboard.up("Space");
  });

  test("a manual pause and an overlay made while hidden survive the return", async ({
    page,
  }) => {
    await openFixture(page);
    await setHidden(page, true);

    await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<LifecycleExtension>("lifecycle")!
        .setManualPause(true),
    );
    await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<LifecycleExtension>("lifecycle")!
        .pushOverlay(),
    );
    expect(await read(page)).toMatchObject({
      stack: ["play-scene", "overlay-scene"],
      overlayPauses: 1,
    });

    await setHidden(page, false);

    expect(await read(page)).toMatchObject({
      active: true,
      paused: true,
      overlayPauses: 1,
      overlayResumes: 1,
    });
  });

  test("each engine follows its own host", async ({ page }) => {
    await openFixture(page);

    await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<LifecycleExtension>("lifecycle")!
        .report({ activity: "inactive" }),
    );

    expect(await secondPaused(page)).toBe(true);
    expect(await read(page)).toMatchObject({ active: true, paused: false });

    await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<LifecycleExtension>("lifecycle")!
        .destroySecond(),
    );
    await setHidden(page, true);

    expect(await read(page)).toMatchObject({ active: false, paused: true });
    expect(await secondPaused(page)).toBeNull();
  });
});
