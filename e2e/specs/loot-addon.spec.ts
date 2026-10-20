import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LootDiagnostics } from "@yagejs-addons/loot";

interface DemoState {
  rolls: number;
  level: number;
  bagItems: { item: string; quantity: number }[];
  bankedQuantity: number;
  pendingQuantity: number;
  pending: { item: string; quantity: number; reason: string }[];
}

async function boot(page: Page): Promise<void> {
  await page.goto("/loot-addon.html?test&seed=42");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector.time.isFrozen() &&
      window.__yage__!.inspector.getSceneStack().at(-1)?.name === "loot-addon",
  );
  await page.evaluate(() => window.__yage__!.inspector.time.step(1));
}

async function tap(page: Page, key: string): Promise<void> {
  await page.evaluate(async (key) => {
    const inspector = window.__yage__!.inspector;
    inspector.input.keyDown(key);
    await inspector.time.stepAsync(1);
    inspector.input.keyUp(key);
    await inspector.time.stepAsync(1);
  }, key);
}

async function state(page: Page) {
  return page.evaluate(() => {
    const inspector = window.__yage__!.inspector;
    return {
      demo: inspector.getComponentData(
        "LootDemoEntity",
        "LootDemo",
      ) as DemoState,
      loot: inspector.getComponentData("LootDemoEntity", "LootComponent") as {
        diagnostics: LootDiagnostics | null;
      },
      errors: inspector.getErrors().callbackErrors,
    };
  });
}

function owned(demo: DemoState): number {
  return (
    demo.bankedQuantity +
    demo.pendingQuantity +
    demo.bagItems.reduce((sum, item) => sum + item.quantity, 0)
  );
}

test("loot-addon explains seeded rewards and preserves inventory overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await tap(page, "Space");
  const first = await state(page);
  const roll = first.loot.diagnostics!;
  expect(first.demo.rolls).toBe(1);
  expect(roll.rewards.map((reward) => reward.source.entry).sort()).toEqual([
    "coins",
    "herbs",
    "potion",
  ]);
  const total = roll.rewards.reduce((sum, reward) => sum + reward.quantity, 0);
  expect(owned(first.demo)).toBe(total);
  expect(first.demo.pendingQuantity).toBeGreaterThan(0);
  expect(first.demo.pending[0]?.reason).toBe("capacity");
  expect(
    roll.trace.find((entry) => entry.pool === "treasure")?.candidates[0],
  ).toMatchObject({
    entry: "ruby",
    status: "condition",
    reason: "requires-level-3",
    probability: 0,
  });
  expect(
    roll.trace.some((entry) =>
      entry.candidates.some(
        (candidate) => candidate.status === "already-selected",
      ),
    ),
  ).toBe(true);

  // Repeated open requests do not discard or reroll rewards waiting for space.
  await tap(page, "Space");
  expect((await state(page)).demo.rolls).toBe(1);
  await tap(page, "KeyB");
  const collected = await state(page);
  expect(collected.demo.pendingQuantity).toBe(0);
  expect(collected.demo.bankedQuantity).toBeGreaterThan(0);
  expect(owned(collected.demo)).toBe(total);

  await tap(page, "KeyL");
  await tap(page, "Space");
  const high = await state(page);
  expect(high.demo.level).toBe(3);
  expect(high.demo.rolls).toBe(2);
  expect(
    high.loot.diagnostics?.trace.find((entry) => entry.pool === "treasure")
      ?.candidates[0],
  ).toMatchObject({
    entry: "ruby",
    status: "eligible",
    weight: 4,
    probability: 4 / 7,
  });
  expect(high.errors).toEqual([]);
  expect(errors).toEqual([]);

  await boot(page);
  await tap(page, "Space");
  expect((await state(page)).loot.diagnostics).toEqual(roll);
});

test("loot-addon canvas controls use pointer input", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const inspector = window.__yage__!.inspector;
    inspector.input.mouseMove(160, 600);
    inspector.input.mouseDown(0);
    await inspector.time.stepAsync(1);
    inspector.input.mouseUp(0);
    await inspector.time.stepAsync(1);
  });
  expect((await state(page)).demo.rolls).toBe(1);
});
