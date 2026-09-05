import { expect, test, type Page } from "@playwright/test";
import { gotoFixture, waitForClock } from "./helpers.js";

/**
 * The fixture (`e2e/fixtures/src/interaction.ts`) exposes the interactor,
 * demo state, and the three test interactables on `window.__interaction__`.
 * Movement is driven through the REAL `InputManager`
 * (`window.__yage__.inspector.input`) — not by poking the model directly —
 * so these tests exercise the addon's own auto-input wiring, the point of
 * `Interactor.action` + the optional `@yagejs/input` peer.
 */
interface Handle {
  interactor: { focus: unknown; enabled: boolean; interact(): void };
  state: { coinsCollected: number; lastPrompt: string | null };
  coinInteractable: unknown;
  crateInteractable: unknown;
  chestInteractable: unknown;
}

interface ProbeData {
  isCoinFocused: boolean;
  isCrateFocused: boolean;
  isChestFocused: boolean;
  focusIsNull: boolean;
  lastPrompt: string | null;
  coinsCollected: number;
}

function probe(page: Page): Promise<ProbeData> {
  return page.evaluate(() => {
    const h = (window as unknown as { __interaction__: Handle })
      .__interaction__;
    const focus = h.interactor.focus;
    return {
      isCoinFocused: focus === h.coinInteractable,
      isCrateFocused: focus === h.crateInteractable,
      isChestFocused: focus === h.chestInteractable,
      focusIsNull: focus === null,
      lastPrompt: h.state.lastPrompt,
      coinsCollected: h.state.coinsCollected,
    };
  });
}

/** Hold a movement key for `frames` frames against the real InputManager. */
async function walk(page: Page, code: string, frames: number): Promise<void> {
  await page.evaluate(
    ({ code: c, frames: f }) => window.__yage__!.inspector.input.hold(c, f),
    { code, frames },
  );
}

async function fireInteract(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.__yage__!.inspector.input.fireAction("interact"),
  );
}

async function boot(page: Page): Promise<void> {
  await gotoFixture(page, "/interaction.html");
  await waitForClock(page);
  await page.waitForFunction(
    () =>
      (window as unknown as { __interaction__?: unknown }).__interaction__ !==
      undefined,
  );
}

test.describe("@yagejs-addons/interaction addon", () => {
  test("walking the player toward the coin makes it the focus", async ({
    page,
  }) => {
    await boot(page);

    const before = await probe(page);
    expect(before.focusIsNull).toBe(true);
    expect(before.lastPrompt).toBeNull();

    // Coin sits 160px below the player's start; move-down for enough frames
    // to comfortably cross the 80px interactor range.
    await walk(page, "KeyS", 60);

    const after = await probe(page);
    expect(after.isCoinFocused).toBe(true);
    expect(after.lastPrompt).toBe("Pick up");
  });

  test("firing the interact action destroys the coin and increments the counter", async ({
    page,
  }) => {
    await boot(page);
    await walk(page, "KeyS", 60);
    expect((await probe(page)).isCoinFocused).toBe(true);

    await fireInteract(page);
    // The destroy is queued for end-of-frame flush; step one more frame.
    await page.evaluate(() => window.__yage__!.inspector.time.stepAsync(1));

    const after = await probe(page);
    expect(after.coinsCollected).toBe(1);
    expect(after.focusIsNull).toBe(true); // the coin is gone — nothing left to focus
  });

  test("walking away clears focus to null", async ({ page }) => {
    await boot(page);
    await walk(page, "KeyS", 60);
    expect((await probe(page)).isCoinFocused).toBe(true);

    // Walk sideways, away from BOTH the coin and the crate/chest pair (which
    // sit on the same vertical line above the start) — walking back up would
    // cross straight through the crate/chest's range and refocus on it.
    await walk(page, "KeyA", 100);

    const after = await probe(page);
    expect(after.focusIsNull).toBe(true);
    expect(after.lastPrompt).toBeNull();
  });

  test("two overlapping interactables resolve to the higher-priority one deterministically", async ({
    page,
  }) => {
    await boot(page);

    // Crate (priority 0) and chest (priority 10) sit at the SAME position,
    // 160px above the player's start.
    await walk(page, "KeyW", 60);

    const after = await probe(page);
    expect(after.isChestFocused).toBe(true);
    expect(after.isCrateFocused).toBe(false);
    expect(after.lastPrompt).toBe("Open quest chest");
  });
});
