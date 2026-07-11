import { expect, test, type Page } from "@playwright/test";
import { gotoFixture, getEntityPosition, stepFrames, waitForClock } from "./helpers";

/**
 * The fixture (`e2e/fixtures/src/behaviors.ts`) exposes fixed targets and
 * the obstacle list on `window.__behaviors__` so this file never hardcodes
 * them a second time. Every agent targets a fixed point — determinism comes
 * from the frozen clock, no player input needed.
 */
interface FixtureData {
  seekTarget: { x: number; y: number };
  fleeTarget: { x: number; y: number };
  obstacles: { x: number; y: number; radius: number }[];
  boidNames: string[];
}

function fixtureData(page: Page): Promise<FixtureData> {
  return page.evaluate(
    () => (window as unknown as { __behaviors__: FixtureData }).__behaviors__,
  );
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test.describe("Behaviors addon fixture", () => {
  test("a seek agent's distance to a fixed target strictly decreases and converges", async ({
    page,
  }) => {
    await gotoFixture(page, "/behaviors.html");
    await waitForClock(page);
    const { seekTarget } = await fixtureData(page);

    // Phase 1 — well before arrival: distance decreases strictly every checkpoint.
    const distances: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (i > 0) await stepFrames(page, 30);
      const pos = await getEntityPosition(page, "seeker");
      expect(pos).toBeDefined();
      distances.push(dist(pos!, seekTarget));
    }
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThan(distances[i - 1]!);
    }

    // Phase 2 — run well past arrival. `seek` has no slowdown (that's `arrive`'s
    // job), so once close it oscillates in a tight band around the target
    // instead of settling exactly on it; assert it converged into that band.
    await stepFrames(page, 200);
    const finalPos = await getEntityPosition(page, "seeker");
    expect(dist(finalPos!, seekTarget)).toBeLessThan(20);
  });

  test("a flee agent's distance from a fixed target grows", async ({ page }) => {
    await gotoFixture(page, "/behaviors.html");
    await waitForClock(page);
    const { fleeTarget } = await fixtureData(page);

    const distances: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (i > 0) await stepFrames(page, 30);
      const pos = await getEntityPosition(page, "fleer");
      expect(pos).toBeDefined();
      distances.push(dist(pos!, fleeTarget));
    }

    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThan(distances[i - 1]!);
    }
  });

  test("an avoidObstacles agent's clearance to every obstacle stays above its radius", async ({
    page,
  }) => {
    await gotoFixture(page, "/behaviors.html");
    await waitForClock(page);
    const { obstacles } = await fixtureData(page);

    for (let i = 0; i < 40; i++) {
      await stepFrames(page, 10);
      const pos = await getEntityPosition(page, "avoider");
      expect(pos).toBeDefined();
      for (const obstacle of obstacles) {
        const clearance = dist(pos!, obstacle) - obstacle.radius;
        expect(clearance).toBeGreaterThan(0);
      }
    }
  });

  test("a boid flock's mean pairwise distance stays bounded", async ({ page }) => {
    await gotoFixture(page, "/behaviors.html");
    await waitForClock(page);
    const { boidNames } = await fixtureData(page);

    async function meanPairwiseDistance(): Promise<number> {
      const positions = await Promise.all(boidNames.map((name) => getEntityPosition(page, name)));
      let sum = 0;
      let count = 0;
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          sum += dist(positions[i]!, positions[j]!);
          count++;
        }
      }
      return sum / count;
    }

    for (let i = 0; i < 30; i++) {
      await stepFrames(page, 10);
      const mean = await meanPairwiseDistance();
      // Neither collapses to a point nor scatters off unbounded.
      expect(mean).toBeGreaterThan(5);
      expect(mean).toBeLessThan(400);
    }
  });
});
