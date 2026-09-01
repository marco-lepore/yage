import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

async function openCleanFixture(page: Page): Promise<void> {
  await gotoFixture(page, "/save-load.html");
  await page.waitForFunction(
    () => (window as any).__saveFixture__ !== undefined,
  );
  await page.evaluate(() => {
    const prefix = "yage-e2e-save:";
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  });
  await page.reload();
  await page.waitForFunction(
    () => (window as any).__saveFixture__ !== undefined,
  );
}

test.describe("controlled save", () => {
  test.beforeEach(async ({ page }) => {
    await openCleanFixture(page);
  });

  test("loads a typed state root after a fresh page boot", async ({ page }) => {
    await page.evaluate(async () => {
      const fixture = (window as any).__saveFixture__;
      fixture.setState(42, 300, 150, "boss-defeated");
      await fixture.saveSlot("quick");
    });

    await page.reload();
    await page.waitForFunction(
      () => (window as any).__saveFixture__ !== undefined,
    );

    expect(
      await page.evaluate(() => (window as any).__saveFixture__.state()),
    ).toEqual({ score: 0, player: { x: 100, y: 200 }, flags: [] });

    await page.evaluate(() =>
      (window as any).__saveFixture__.loadSlot("quick"),
    );

    expect(
      await page.evaluate(() => (window as any).__saveFixture__.state()),
    ).toEqual({
      score: 42,
      player: { x: 300, y: 150 },
      flags: ["boss-defeated"],
    });
  });

  test("lists and deletes named slots", async ({ page }) => {
    await page.evaluate(async () => {
      const fixture = (window as any).__saveFixture__;
      fixture.setState(7, 10, 20, "intro-seen");
      await fixture.saveSlot("manual-1");
    });

    const slots = await page.evaluate(() =>
      (window as any).__saveFixture__.listSlots(),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe("manual-1");

    await page.evaluate(() =>
      (window as any).__saveFixture__.deleteSlot("manual-1"),
    );
    expect(
      await page.evaluate(() => (window as any).__saveFixture__.listSlots()),
    ).toEqual([]);
  });

  test("reports a missing slot", async ({ page }) => {
    const error = await page.evaluate(async () => {
      try {
        await (window as any).__saveFixture__.loadSlot("missing");
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    });

    expect(error).toContain('No save found for store "run" in slot "missing"');
  });
});
