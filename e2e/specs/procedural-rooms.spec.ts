import { expect, test, type Page } from "@playwright/test";

interface Generation {
  generation: {
    status: string;
    options: { seed: number };
    placedRooms: {
      id: string;
      templateId: string;
      variantId: string | null;
      metadata: Record<string, unknown>;
      tags: string[];
      x: number;
      y: number;
    }[];
    connections: unknown[];
    validation: { connectedWalkableCells: boolean } | null;
    diagnostics: { code: string; message: string }[];
  };
}
interface Exploration {
  exploration: {
    currentRoom: string;
    selectedRoom: string;
    visited: string[];
    pathLength: number;
    keys: string[];
    mode: string;
    caveSize: { width: number; height: number } | null;
  };
}
async function generation(page: Page): Promise<Generation["generation"]> {
  return page.evaluate(
    () =>
      (
        window.__yage__!.inspector.getComponentData(
          "LabEntity",
          "GenerationController",
        ) as Generation
      ).generation,
  );
}
async function explore(page: Page): Promise<Exploration["exploration"]> {
  return page.evaluate(
    () =>
      (
        window.__yage__!.inspector.getComponentData(
          "LabEntity",
          "RoomLab",
        ) as Exploration
      ).exploration,
  );
}
async function press(page: Page, key: string): Promise<void> {
  await page.evaluate((key) => {
    const inspector = window.__yage__!.inspector;
    inspector.input.tap(key);
    if (["KeyR", "KeyC", "KeyB", "KeyU"].includes(key)) {
      for (let i = 0; i < 250; i++) {
        const state = inspector.getComponentData(
          "LabEntity",
          "GenerationController",
        ) as Generation;
        if (state.generation.status !== "running") break;
        inspector.time.step(1);
      }
    }
  }, key);
}

test("procedural-rooms: explore every room, regenerate seeds and inspect bounded failures", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/procedural-rooms.html?test");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector?.time.isFrozen() &&
      window.__yage__.inspector.getSceneStack().length > 0,
  );
  await page.evaluate(() => {
    const inspector = window.__yage__!.inspector;
    for (let i = 0; i < 250; i++) {
      const state = inspector.getComponentData(
        "LabEntity",
        "GenerationController",
      ) as Generation;
      if (state.generation.status !== "running") break;
      inspector.time.step(1);
    }
  });
  const first = await generation(page);
  expect(first.status).toBe("succeeded");
  expect(first.validation?.connectedWalkableCells).toBe(true);
  expect(first.placedRooms).toHaveLength(15);
  expect(first.connections).toHaveLength(14);
  expect(
    first.placedRooms.find((room) => room.templateId === "shop"),
  ).toMatchObject({
    variantId: "healing",
    metadata: { stock: "potions", merchant: "traveller" },
  });
  const moss = first.placedRooms.filter((room) => room.tags.includes("moss"));
  expect(moss.length).toBeGreaterThanOrEqual(2);
  expect(moss.length).toBeLessThanOrEqual(5);
  const select = async (id: string): Promise<void> => {
    for (let i = 0; i < 15; i++) {
      if ((await explore(page)).selectedRoom === id) return;
      await press(page, "Tab");
    }
    expect((await explore(page)).selectedRoom).toBe(id);
  };
  const follow = async (): Promise<void> => {
    const target = await explore(page);
    expect(target.pathLength).toBeGreaterThan(0);
    await page.evaluate((steps) => {
      const inspector = window.__yage__!.inspector;
      for (let i = 0; i < steps; i++) inspector.input.tap("Space");
    }, target.pathLength - 1);
    expect((await explore(page)).currentRoom).toBe(target.selectedRoom);
  };
  await select("boss");
  expect((await explore(page)).pathLength).toBe(0);
  await select("treasure-a");
  await follow();
  expect((await explore(page)).keys).toContain("key-a");
  await select("boss");
  // A route may pass through the other treasure room; otherwise one key remains insufficient.
  if ((await explore(page)).keys.length === 1)
    expect((await explore(page)).pathLength).toBe(0);
  await select("treasure-b");
  await follow();
  expect((await explore(page)).keys.sort()).toEqual(["key-a", "key-b"]);
  await select("boss");
  await follow();
  for (const room of first.placedRooms) {
    await select(room.id);
    await follow();
  }
  expect((await explore(page)).visited).toHaveLength(15);
  const layouts = new Set([JSON.stringify(first.placedRooms)]);
  for (let seed = 0; seed < 5; seed++) {
    await press(page, "KeyR");
    const next = await generation(page);
    expect(next.status).toBe("succeeded");
    expect(next.options.seed).toBe(first.options.seed + seed + 1);
    layouts.add(JSON.stringify(next.placedRooms));
  }
  expect(layouts.size).toBeGreaterThan(2);
  await press(page, "KeyB");
  expect((await generation(page)).status).toBe("budget-exceeded");
  expect(
    (await generation(page)).diagnostics.some((d) =>
      d.message.includes("does not prove"),
    ),
  ).toBe(true);
  await press(page, "KeyU");
  expect((await generation(page)).status).toBe("exhausted");
  await press(page, "KeyR");
  expect((await generation(page)).status).toBe("succeeded");
  await press(page, "KeyC");
  expect((await generation(page)).status).toBe("succeeded");
  expect((await explore(page)).caveSize).toEqual({ width: 72, height: 42 });
  expect((await explore(page)).mode).toBe("cave");
  await press(page, "KeyC");
  expect((await generation(page)).status).toBe("succeeded");
  expect((await explore(page)).keys).toEqual([]);
  expect(errors).toEqual([]);
});
