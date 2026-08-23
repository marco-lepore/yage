import { expect, test, type Page } from "@playwright/test";
import { gotoFixture, waitForClock } from "./helpers.js";

/**
 * The fixture (`e2e/fixtures/src/quests-addon.ts`) exposes a `QuestLog` and
 * an `@yagejs-addons/inventory` `Inventory` on `window.__quests__`, wired
 * with the addon's own one-line binding adapter
 * (`inventory.on("itemAdded", …) -> log.advance(...)`). Tests drive the
 * inventory model (the "other addon" side of the binding) and read the quest
 * log directly — the same surface a journal/tracker HUD would use.
 */
interface Handle {
  log: {
    start(quest: string): { ok: boolean; reason?: string };
    status(quest: string): string;
    progress(quest: string, objective: string): number;
    objectiveDone(quest: string, objective: string): boolean;
    active(): string[];
    completed(): string[];
    complete(quest: string, objective: string): void;
    snapshot(): unknown;
    restore(snapshot: unknown): void;
  };
  inventory: { add(id: string, quantity?: number): { added: number } };
}

function probe(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as { __quests__: Handle }).__quests__;
    return {
      gatherStatus: h.log.status("gatherHerbs"),
      packStatus: h.log.status("thinThePack"),
      herbProgress: h.log.progress("gatherHerbs", "herb"),
      active: h.log.active(),
      completed: h.log.completed(),
    };
  });
}

async function addHerb(page: Page, quantity: number): Promise<void> {
  await page.evaluate((q) => {
    const h = (window as unknown as { __quests__: Handle }).__quests__;
    h.inventory.add("redHerb", q);
  }, quantity);
}

test.describe("quests addon", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFixture(page, "/quests-addon.html");
    await waitForClock(page);
  });

  test("starting a quest sets it active", async ({ page }) => {
    let state = await probe(page);
    expect(state.gatherStatus).toBe("available");

    await page.evaluate(() => {
      const h = (window as unknown as { __quests__: Handle }).__quests__;
      h.log.start("gatherHerbs");
    });

    state = await probe(page);
    expect(state.gatherStatus).toBe("active");
    expect(state.active).toEqual(["gatherHerbs"]);
  });

  test("a simulated inventory add advances the collect objective via the binding adapter", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const h = (window as unknown as { __quests__: Handle }).__quests__;
      h.log.start("gatherHerbs");
    });

    await addHerb(page, 3);
    let state = await probe(page);
    expect(state.herbProgress).toBe(3);

    await addHerb(page, 2);
    state = await probe(page);
    expect(state.herbProgress).toBe(5);

    await addHerb(page, 2); // surplus pickup past the target
    state = await probe(page);
    expect(state.herbProgress).toBe(5); // clamped to target
  });

  test("completing all objectives auto-completes the quest AND auto-starts the chained quest", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const h = (window as unknown as { __quests__: Handle }).__quests__;
      h.log.start("gatherHerbs");
    });

    // Chain prereq: thinThePack is locked before gatherHerbs completes.
    let state = await probe(page);
    expect(state.packStatus).toBe("locked");

    await addHerb(page, 5); // completes the "herb" objective
    await page.evaluate(() => {
      const h = (window as unknown as { __quests__: Handle }).__quests__;
      h.log.complete("gatherHerbs", "turnIn"); // completes the "turnIn" objective
    });

    state = await probe(page);
    expect(state.gatherStatus).toBe("completed");
    expect(state.completed).toEqual(["gatherHerbs"]);
    // Auto-started by the fixture's `on("questCompleted", …)` chain adapter.
    expect(state.packStatus).toBe("active");
    expect(state.active).toEqual(["thinThePack"]);
  });

  test("a snapshot -> restore round trip preserves quest state", async ({ page }) => {
    await page.evaluate(() => {
      const h = (window as unknown as { __quests__: Handle }).__quests__;
      h.log.start("gatherHerbs");
    });
    await addHerb(page, 3);

    const snapshot = await page.evaluate(() => {
      const h = (window as unknown as { __quests__: Handle }).__quests__;
      return h.log.snapshot();
    });

    // Mutate further, then restore the earlier snapshot.
    await addHerb(page, 2);
    let state = await probe(page);
    expect(state.herbProgress).toBe(5);

    await page.evaluate((snap) => {
      const h = (window as unknown as { __quests__: Handle }).__quests__;
      h.log.restore(snap);
    }, snapshot);

    state = await probe(page);
    expect(state.gatherStatus).toBe("active");
    expect(state.herbProgress).toBe(3);
  });
});
