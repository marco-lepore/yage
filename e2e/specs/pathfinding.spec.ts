import { expect, test, type Page } from "@playwright/test";
import { gotoFixture, waitForClock, stepFrames, getEntityPosition } from "./helpers";

/**
 * The fixture (`e2e/fixtures/src/pathfinding.ts`) builds a fixed 6x4 grid
 * (20px tiles) with a vertical wall at col 3, rows 0-2 (row 3 is the gap),
 * and exposes `window.__pathfinding__` — the `GridGraph` plus a `walkTo(x, y)`
 * command that paths the "agent" entity there. Tests assert directly on the
 * `Path` returned by `walkTo` (waypoints/cost/cells) and drive movement
 * through the frozen clock, reading the agent's position back via the
 * Inspector API.
 */
interface Handle {
  grid: {
    cols: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
  };
  walkTo(
    x: number,
    y: number,
  ): { waypoints: { x: number; y: number }[]; cells: { col: number; row: number }[]; cost: number } | null;
  isMoving(): boolean;
}

async function boot(page: Page): Promise<void> {
  await gotoFixture(page, "/pathfinding.html");
  await waitForClock(page);
}

function walkTo(page: Page, x: number, y: number): Promise<ReturnType<Handle["walkTo"]>> {
  return page.evaluate(
    ({ x, y }) => (window as unknown as { __pathfinding__: Handle }).__pathfinding__.walkTo(x, y),
    { x, y },
  );
}

test.describe("@yagejs/pathfinding", () => {
  test("routes around the wall through its gap and reports the expected cost", async ({ page }) => {
    await boot(page);

    // Start (0,0) [world (10,10)] to goal (5,0) [world (110,10)]: the wall at
    // col 3 rows 0-2 forces a detour down through the row-3 gap and back up.
    const path = await walkTo(page, 110, 10);
    expect(path).not.toBeNull();
    expect(path!.cost).toBe(11);
    expect(path!.waypoints).toHaveLength(12);
    expect(path!.waypoints[0]).toEqual({ x: 10, y: 10 });
    expect(path!.waypoints.at(-1)).toEqual({ x: 110, y: 10 });

    // Detour avoids every walled cell (col 3, rows 0-2).
    const walled = path!.cells.some((c) => c.col === 3 && c.row < 3);
    expect(walled).toBe(false);
    // ...and actually passes through the gap at (3, 3).
    expect(path!.cells.some((c) => c.col === 3 && c.row === 3)).toBe(true);
  });

  test("returns null for a goal cell that isn't walkable", async ({ page }) => {
    await boot(page);
    // (3, 1) [world (70, 30)] is a walled cell.
    const path = await walkTo(page, 70, 30);
    expect(path).toBeNull();
  });

  test("moves the agent entity along the computed path", async ({ page }) => {
    await boot(page);

    const before = await getEntityPosition(page, "agent");
    expect(before).toEqual({ x: 10, y: 10 });

    await walkTo(page, 50, 10); // (0,0) -> (2,0), a clear 2-step straight line
    await stepFrames(page, 60); // more than enough time at 200px/s over 40px

    const moving = await page.evaluate(
      () => (window as unknown as { __pathfinding__: Handle }).__pathfinding__.isMoving(),
    );
    expect(moving).toBe(false);

    const after = await getEntityPosition(page, "agent");
    expect(after).toEqual({ x: 50, y: 10 });
  });
});
