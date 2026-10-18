import { devices, expect, test } from "@playwright/test";
import type { CDPSession, Frame, Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

interface DisplayReading {
  isFullscreen: boolean;
  fullscreenSupport: string;
  orientation: string | null;
  orientationLockSupport: string;
  resolution: number;
  canvasSize: { width: number; height: number };
  backingWidth: number;
  buttonVisible: boolean;
  buttonLabel: string;
}

interface SecondReading {
  isFullscreen: boolean;
  fullscreenSupport: string;
  orientation: string | null;
  calls: string[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DisplayExtension {
  state(): DisplayReading;
  log(): string[];
  clearLog(): void;
  counters(): { request: number; exit: number; error: number };
  request(): Promise<string>;
  exit(): Promise<string>;
  requestTwice(): Promise<string[]>;
  requestThenExit(): Promise<string[]>;
  lock(value: string): Promise<string>;
  fullscreenOther(): Promise<string>;
  otherIsFullscreen(): boolean;
  canvasRect(): Rect;
  buttonRect(): Rect;
  canvasToVirtual(x: number, y: number): { x: number; y: number };
  pointer(): { x: number; y: number } | null;
  secondState(): SecondReading | null;
  secondSet(state: { fullscreen?: boolean; orientation?: string }): void;
  secondRequest(): Promise<string>;
  destroySecond(): void;
}

async function openFixture(page: Page, query = ""): Promise<void> {
  await gotoFixture(page, `/display.html${query}`);
  await page.waitForFunction(
    () => window.__yage__?.inspector?.getExtension("display") !== undefined,
  );
}

function read(page: Page): Promise<DisplayReading> {
  return page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<DisplayExtension>("display")!
      .state(),
  );
}

function log(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window.__yage__!.inspector.getExtension<DisplayExtension>("display")!.log(),
  );
}

/** Call one extension method by name, with the arguments it takes. */
function drive<T>(page: Page, call: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, passed]) => {
      const extension =
        window.__yage__!.inspector.getExtension<
          Record<string, (...rest: unknown[]) => unknown>
        >("display")!;
      return extension[name as string]!(...(passed as unknown[])) as Promise<T>;
    },
    [call, args] as [string, unknown[]],
  );
}

test.describe("display contract", () => {
  test("reports the page's fullscreen and orientation at start", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await read(page)).toMatchObject({
      isFullscreen: false,
      fullscreenSupport: "supported",
      orientation: "landscape-primary",
      orientationLockSupport: "unknown",
      buttonVisible: true,
      buttonLabel: "Fullscreen",
    });
    expect(await log(page)).toEqual([]);
  });

  test("the template's button toggles fullscreen and follows the state", async ({
    page,
  }) => {
    await openFixture(page);

    await page.click("#fullscreen");
    await expect.poll(async () => (await read(page)).isFullscreen).toBe(true);
    expect(await log(page)).toEqual(["fullscreen:true"]);
    expect((await read(page)).buttonLabel).toBe("Exit fullscreen");

    await drive(page, "clearLog");
    await page.click("#fullscreen");
    await expect.poll(async () => (await read(page)).isFullscreen).toBe(false);
    expect(await log(page)).toEqual(["fullscreen:false"]);
    expect((await read(page)).buttonLabel).toBe("Fullscreen");
  });

  test("emits the change before the request resolves", async ({ page }) => {
    await openFixture(page);

    expect(await drive<string>(page, "request")).toBe("resolved");

    expect(await log(page)).toEqual(["fullscreen:true", "resolved:request"]);
    expect(await drive(page, "counters")).toMatchObject({ request: 1 });
  });

  test("an exit with nothing fullscreen resolves and asks nothing", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await drive<string>(page, "exit")).toBe("resolved");

    expect(await log(page)).toEqual(["resolved:exit"]);
    expect(await drive(page, "counters")).toMatchObject({ exit: 0 });
  });

  test("leaves another element's fullscreen alone", async ({ page }) => {
    await openFixture(page);

    expect(await drive<string>(page, "fullscreenOther")).toBe("resolved");
    expect(await drive<boolean>(page, "otherIsFullscreen")).toBe(true);
    expect(await log(page)).toEqual(["resolved:other"]);

    expect(await drive<string>(page, "exit")).toBe("resolved");

    expect(await drive<boolean>(page, "otherIsFullscreen")).toBe(true);
    expect(await drive(page, "counters")).toMatchObject({ exit: 0 });
    expect((await read(page)).isFullscreen).toBe(false);
  });

  test("two requests in one task share the page's one request", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await drive<string[]>(page, "requestTwice")).toEqual([
      "resolved",
      "resolved",
    ]);

    expect(await drive(page, "counters")).toMatchObject({
      request: 1,
      error: 0,
    });
    expect((await read(page)).isFullscreen).toBe(true);
  });

  test("a request and an exit in one task end with the last call", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await drive<string[]>(page, "requestThenExit")).toEqual([
      "resolved",
      "resolved",
    ]);

    expect((await read(page)).isFullscreen).toBe(false);
    expect(await log(page)).toEqual([
      "fullscreen:true",
      "resolved:request",
      "fullscreen:false",
      "resolved:exit",
    ]);
  });

  test("the second engine follows its own display and leaves the page alone", async ({
    page,
  }) => {
    await openFixture(page);

    await drive(page, "secondSet", { fullscreen: true });
    expect(await drive<SecondReading>(page, "secondState")).toMatchObject({
      isFullscreen: true,
      fullscreenSupport: "supported",
    });
    expect(await log(page)).toEqual(["second-fullscreen:true"]);

    await drive(page, "clearLog");
    await drive(page, "secondSet", { fullscreen: false });
    expect(await drive<string>(page, "secondRequest")).toBe("resolved");
    expect(await drive<SecondReading>(page, "secondState")).toMatchObject({
      calls: ["request"],
    });
    expect(await drive(page, "counters")).toMatchObject({ request: 0 });
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();

    await drive(page, "destroySecond");
    await drive(page, "clearLog");
    await drive(page, "secondSet", { fullscreen: true });
    expect(await log(page)).toEqual([]);
    expect(await drive<SecondReading | null>(page, "secondState")).toBeNull();
  });
});

test.describe("display in a frame", () => {
  /** The display fixture inside the named frame of the two-frame page. */
  async function openFramed(page: Page, id: string): Promise<Frame> {
    await page.goto("/display-frames.html");
    const element = await page.waitForSelector(`#${id}`);
    const frame = await element.contentFrame();
    await frame!.waitForFunction(
      () => window.__yage__?.inspector?.getExtension("display") !== undefined,
    );
    return frame!;
  }

  function readFrame(frame: Frame): Promise<DisplayReading> {
    return frame.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<DisplayExtension>("display")!
        .state(),
    );
  }

  test("a frame from another origin cannot change to fullscreen", async ({
    page,
  }) => {
    const frame = await openFramed(page, "cross-origin");

    expect(await readFrame(frame)).toMatchObject({
      fullscreenSupport: "unsupported",
      buttonVisible: false,
    });
    const outcome = await frame.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<DisplayExtension>("display")!
        .request(),
    );
    expect(outcome).toBe(
      "rejected:RendererPlugin.requestFullscreen: this host cannot change " +
        'to fullscreen (fullscreenSupport is "unsupported").',
    );
  });

  test("a frame from the same origin can", async ({ page }) => {
    const frame = await openFramed(page, "same-origin");

    expect(await readFrame(frame)).toMatchObject({
      fullscreenSupport: "supported",
      buttonVisible: true,
    });
  });
});

/** Change the emulated pixel ratio through the DevTools protocol. */
async function setPixelRatio(
  session: CDPSession,
  page: Page,
  ratio: number,
): Promise<void> {
  const size = page.viewportSize()!;
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: size.width,
    height: size.height,
    deviceScaleFactor: ratio,
    mobile: false,
  });
}

for (const [label, started, changed] of [
  ["1 to 2", 1, 2],
  ["2 to 1", 2, 1],
] as const) {
  test.describe(`canvas density from ${label}`, () => {
    test.use({
      deviceScaleFactor: started,
      viewport: { width: 800, height: 600 },
    });

    test("follows the display, and keeps the pointer aligned", async ({
      page,
      context,
    }) => {
      await openFixture(page);
      expect((await read(page)).resolution).toBe(started);

      const session = await context.newCDPSession(page);
      await setPixelRatio(session, page, changed);

      await expect
        .poll(async () => (await read(page)).resolution)
        .toBe(changed);
      const after = await read(page);
      expect(after.backingWidth).toBe(
        Math.round(after.canvasSize.width * changed),
      );

      const rect = await drive<Rect>(page, "canvasRect");
      await page.mouse.move(rect.x + 100, rect.y + 60);
      await expect
        .poll(async () => await drive(page, "pointer"))
        .toEqual(await drive(page, "canvasToVirtual", 100, 60));
      await session.detach();
    });

    test("stays at the configured resolution", async ({ page, context }) => {
      await openFixture(page, "?resolution=1");
      expect((await read(page)).resolution).toBe(1);

      const session = await context.newCDPSession(page);
      await setPixelRatio(session, page, changed);
      await page.waitForFunction(
        (ratio) => window.devicePixelRatio === ratio,
        changed,
      );

      expect((await read(page)).resolution).toBe(1);
      await session.detach();
    });
  });
}

for (const ratio of [1, 2] as const) {
  test.describe(`safe-area insets at pixel ratio ${ratio}`, () => {
    test.use({
      deviceScaleFactor: ratio,
      viewport: { width: 800, height: 600 },
    });

    test("are subtracted once, and leave the button inside the usable area", async ({
      page,
      context,
    }) => {
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 40, right: 10, bottom: 20, left: 30 },
      });
      await openFixture(page);

      const state = await read(page);
      expect(state.canvasSize).toEqual({ width: 760, height: 540 });
      const canvas = await drive<Rect>(page, "canvasRect");
      expect(Math.round(canvas.x)).toBe(30);
      expect(Math.round(canvas.y)).toBe(40);

      const button = await drive<Rect>(page, "buttonRect");
      expect(button.x).toBeGreaterThanOrEqual(30);
      expect(button.y).toBeGreaterThanOrEqual(40);
      expect(button.x + button.width).toBeLessThanOrEqual(790);

      await page.mouse.move(
        canvas.x + canvas.width / 2,
        canvas.y + canvas.height / 2,
      );
      await expect
        .poll(async () => await drive(page, "pointer"))
        .toEqual(
          await drive(
            page,
            "canvasToVirtual",
            canvas.width / 2,
            canvas.height / 2,
          ),
        );
      await session.detach();
    });
  });
}

const pixel7 = devices["Pixel 7"];

/** The Pixel 7 profile without its pixel ratio, which each group sets. */
const phone = {
  viewport: pixel7.viewport,
  userAgent: pixel7.userAgent,
  isMobile: pixel7.isMobile,
  hasTouch: pixel7.hasTouch,
};

for (const ratio of [1, 2] as const) {
  test.describe(`orientation on a phone at pixel ratio ${ratio}`, () => {
    test.use({ ...phone, deviceScaleFactor: ratio });

    test("reports one change per rotation and keeps touch aligned", async ({
      page,
    }) => {
      await openFixture(page);
      expect((await read(page)).orientation).toBe("portrait-primary");

      await drive(page, "clearLog");
      await page.setViewportSize({ width: 863, height: 360 });

      await expect
        .poll(async () => (await read(page)).orientation)
        .toBe("landscape-primary");
      expect(await log(page)).toEqual(["orientation:landscape-primary"]);
      await expect
        .poll(async () => (await read(page)).canvasSize.width)
        .toBe(863);

      const rect = await drive<Rect>(page, "canvasRect");
      await page.mouse.move(rect.x + rect.width / 4, rect.y + rect.height / 4);
      await expect
        .poll(async () => await drive(page, "pointer"))
        .toEqual(
          await drive(page, "canvasToVirtual", rect.width / 4, rect.height / 4),
        );
    });
  });
}

test.describe("orientation lock on a phone", () => {
  test.use({ ...phone, deviceScaleFactor: pixel7.deviceScaleFactor });

  // An emulated phone, not a physical device: Chromium accepts a lock that a
  // real browser may refuse, and the screen does not turn.
  test("a lock resolves with the orientation the host reports", async ({
    page,
  }) => {
    await openFixture(page);

    const result = await drive<string>(page, "lock", "landscape");

    expect(result).toBe((await read(page)).orientation ?? "null");
  });
});
