import { devices, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

interface HostReading {
  runtime: string;
  os: string;
  appVersion: string | null;
  appBuild: string | null;
  runtimeVersion: string | null;
  frame: number;
}

interface HostExtension {
  first(): HostReading;
  second(): HostReading | null;
  destroySecond(): void;
  userAgent(): string;
}

const BROWSER_HOST = {
  runtime: "browser",
  os: "unknown",
  appVersion: null,
  appBuild: null,
  runtimeVersion: null,
};

async function openFixture(page: Page): Promise<void> {
  await gotoFixture(page, "/host.html");
  await page.waitForFunction(
    () => window.__yage__?.inspector?.getExtension("host") !== undefined,
  );
}

function readFirst(page: Page): Promise<HostReading> {
  return page.evaluate(() =>
    window.__yage__!.inspector.getExtension<HostExtension>("host")!.first(),
  );
}

test.describe("host service", () => {
  test("a page with no host adapter reports the browser host", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await readFirst(page)).toMatchObject(BROWSER_HOST);
  });

  test("engines on one page hold separate hosts", async ({ page }) => {
    await openFixture(page);

    const second = await page.evaluate(() =>
      window.__yage__!.inspector.getExtension<HostExtension>("host")!.second(),
    );
    expect(second).toMatchObject({ runtime: "test", os: "android" });
    expect(await readFirst(page)).toMatchObject(BROWSER_HOST);

    const baseline = (await readFirst(page)).frame;
    await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<HostExtension>("host")!
        .destroySecond(),
    );

    expect(await readFirst(page)).toMatchObject(BROWSER_HOST);
    await page.waitForFunction(
      (frame) =>
        window
          .__yage__!.inspector.getExtension<{
            first(): { frame: number };
          }>("host")!
          .first().frame > frame,
      baseline,
    );
  });
});

// The user agent names an emulated phone while the engine keeps the operating
// system unknown: a page reads no authoritative system name from the browser.
for (const [label, device, agentNames] of [
  ["Pixel 7", devices["Pixel 7"], "Android"],
  ["iPhone 14", devices["iPhone 14"], "iPhone"],
] as const) {
  test.describe(`host service under the ${label} user agent`, () => {
    test.use({ userAgent: device.userAgent });

    test("keeps the operating system unknown", async ({ page }) => {
      await openFixture(page);

      const agent = await page.evaluate(() =>
        window
          .__yage__!.inspector.getExtension<HostExtension>("host")!
          .userAgent(),
      );
      expect(agent).toContain(agentNames);

      expect(await readFirst(page)).toMatchObject(BROWSER_HOST);
    });
  });
}
