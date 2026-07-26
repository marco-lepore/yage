import { expect, test, type Page } from "@playwright/test";
import {
  getComponentData,
  getEntityByName,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers";

interface EmitterData {
  acquired: number;
  reclaimed: number;
  poolSize: number;
  leased: number;
  free: number;
}

/** Ids of the pool's members, read through the Inspector. */
async function puffIds(page: Page): Promise<number[]> {
  const entities = await page.evaluate(() => {
    const g = window.__yage__;
    if (!g) throw new Error("__yage__ not available");
    return g.inspector.getEntities();
  });
  return entities
    .filter((e) => e.name === "puff")
    .map((e) => e.id)
    .sort((a, b) => a - b);
}

async function puffActivity(
  page: Page,
): Promise<{ total: number; active: number }> {
  const entities = await page.evaluate(() => {
    const g = window.__yage__;
    if (!g) throw new Error("__yage__ not available");
    return g.inspector.getEntities();
  });
  const puffs = entities.filter((e) => e.name === "puff");
  return { total: puffs.length, active: puffs.filter((e) => e.active).length };
}

test.describe("Entity pool fixture", () => {
  test("recycles the same entities instead of spawning new ones", async ({
    page,
  }) => {
    await gotoFixture(page, "/entity-pool.html");
    await waitForClock(page);

    await stepFrames(page, 6);
    const early = await puffIds(page);
    expect(early).toHaveLength(6);

    await stepFrames(page, 14);
    const late = await puffIds(page);

    // Demand outruns the cap every frame, so the pool stays saturated and the
    // same six entities keep coming back — not one new id in the scene.
    expect(late).toEqual(early);

    const emitter = await getComponentData<EmitterData>(
      page,
      "emitter",
      "Emitter",
    );
    expect(emitter).toBeDefined();
    expect(emitter!.poolSize).toBe(6);
    // Far more acquisitions than members, and the cap forced reclaims.
    expect(emitter!.acquired).toBeGreaterThan(30);
    expect(emitter!.reclaimed).toBeGreaterThan(0);
  });

  test("parks released members dormant and out of name lookups", async ({
    page,
  }) => {
    await gotoFixture(page, "/entity-pool.html");
    await waitForClock(page);

    await stepFrames(page, 10);
    const emitting = await puffActivity(page);
    expect(emitting.active).toBeGreaterThan(0);

    // Emission stops at frame 20; a few frames later every puff has been
    // released, so the members are still there and all of them are dormant.
    await stepFrames(page, 20);
    const idle = await puffActivity(page);
    expect(idle.total).toBe(emitting.total);
    expect(idle.active).toBe(0);

    // Name lookups run through `scene.findEntity`, which skips dormant
    // entities — the whole pool reads as absent while it sits idle.
    expect(await getEntityByName(page, "puff")).toBeUndefined();

    const emitter = await getComponentData<EmitterData>(
      page,
      "emitter",
      "Emitter",
    );
    expect(emitter!.leased).toBe(0);
    expect(emitter!.free).toBe(emitter!.poolSize);
  });
});
