import { expect, test, type Page } from "@playwright/test";
import { gotoFixture, getEntityPosition, stepFrames, waitForClock } from "./helpers.js";

/**
 * The fixture (`e2e/fixtures/src/steering.ts`) exposes fixed targets and
 * the obstacle list on `window.__steering__` so this file never hardcodes
 * them a second time. Every agent targets a fixed point — determinism comes
 * from the frozen clock, no player input needed.
 */
interface FixtureData {
  seekTarget: { x: number; y: number };
  fleeTarget: { x: number; y: number };
  obstacles: { x: number; y: number; radius: number }[];
  boidNames: string[];
  pathWaypoints: { x: number; y: number }[];
  impulseTarget: { x: number; y: number };
  crateName: string;
  colliderObstacle: { x: number; y: number; radius: number };
}

function fixtureData(page: Page): Promise<FixtureData> {
  return page.evaluate(
    () => (window as unknown as { __steering__: FixtureData }).__steering__,
  );
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test.describe("Steering addon fixture", () => {
  test("a seek agent's distance to a fixed target strictly decreases and converges", async ({
    page,
  }) => {
    await gotoFixture(page, "/steering.html");
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
    await gotoFixture(page, "/steering.html");
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
    await gotoFixture(page, "/steering.html");
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

  test("an avoidColliders agent's clearance to a real static collider stays positive", async ({
    page,
  }) => {
    await gotoFixture(page, "/steering.html");
    await waitForClock(page);
    const { colliderObstacle } = await fixtureData(page);

    for (let i = 0; i < 40; i++) {
      await stepFrames(page, 10);
      const pos = await getEntityPosition(page, "collider-avoider");
      expect(pos).toBeDefined();
      const clearance = dist(pos!, colliderObstacle) - colliderObstacle.radius;
      expect(clearance).toBeGreaterThan(0);
    }
  });

  test("a followPath agent visits the waypoints in order and settles at the end", async ({
    page,
  }) => {
    await gotoFixture(page, "/steering.html");
    await waitForClock(page);
    const { pathWaypoints } = await fixtureData(page);

    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i < 40; i++) {
      await stepFrames(page, 10);
      const pos = await getEntityPosition(page, "pather");
      expect(pos).toBeDefined();
      samples.push(pos!);
    }

    // Closest approach to each waypoint is near it, and in path order.
    const closestIndex = pathWaypoints.map((wp) => {
      let best = 0;
      for (let i = 1; i < samples.length; i++) {
        if (dist(samples[i]!, wp) < dist(samples[best]!, wp)) best = i;
      }
      return best;
    });
    for (const [i, wp] of pathWaypoints.entries()) {
      expect(dist(samples[closestIndex[i]!]!, wp)).toBeLessThan(30);
    }
    for (let i = 1; i < closestIndex.length; i++) {
      expect(closestIndex[i]).toBeGreaterThan(closestIndex[i - 1]!);
    }

    // Non-loop: the final waypoint gets arrive semantics — the agent settles there.
    expect(dist(samples.at(-1)!, pathWaypoints.at(-1)!)).toBeLessThan(10);
  });

  test("an impulse-drive agent shoves the crate aside and still reaches its target", async ({
    page,
  }) => {
    await gotoFixture(page, "/steering.html");
    await waitForClock(page);
    const { impulseTarget, crateName } = await fixtureData(page);

    const crateStart = await getEntityPosition(page, crateName);
    expect(crateStart).toBeDefined();

    await stepFrames(page, 400);

    const crateEnd = await getEntityPosition(page, crateName);
    const agentEnd = await getEntityPosition(page, "impulse-agent");
    expect(crateEnd).toBeDefined();
    expect(agentEnd).toBeDefined();
    expect(dist(crateEnd!, crateStart!)).toBeGreaterThan(15); // pushed, not phased through
    expect(dist(agentEnd!, impulseTarget)).toBeLessThan(30); // and still arrived
  });

  test("a knockback deflects the impulse agent and steering pulls it back", async ({ page }) => {
    await gotoFixture(page, "/steering.html");
    await waitForClock(page);
    const { impulseTarget } = await fixtureData(page);

    // Control: on the straight run the agent holds its lane.
    await stepFrames(page, 60);
    const before = await getEntityPosition(page, "impulse-agent");
    expect(before).toBeDefined();
    expect(Math.abs(before!.y - 100)).toBeLessThan(5);

    await page.evaluate(() =>
      (window as unknown as { __steering__: { knockback: () => void } }).__steering__.knockback(),
    );

    // The impulse persists: the agent is visibly off its lane...
    await stepFrames(page, 30);
    const deflected = await getEntityPosition(page, "impulse-agent");
    expect(deflected).toBeDefined();
    expect(Math.abs(deflected!.y - 100)).toBeGreaterThan(40);

    // ...and steering recovers at maxAcceleration, still converging.
    await stepFrames(page, 250);
    const recovered = await getEntityPosition(page, "impulse-agent");
    expect(recovered).toBeDefined();
    expect(dist(recovered!, impulseTarget)).toBeLessThan(30);
  });

  test("movement stays smooth: no frame-to-frame direction flips at cruise", async ({
    page,
  }) => {
    await gotoFixture(page, "/steering.html");
    await waitForClock(page);

    // The acceleration low-pass bounds how fast the walked path can turn.
    // Without it, priority-tier switching near the obstacle and flock-rule
    // flapping alternate the direction by 60-120° every frame (a zigzag
    // path with a V-shaped arrow). Sample per-frame movement deltas and
    // bound the turn between consecutive ones while at cruise speed.
    const agents = ["avoider", "collider-avoider", "boid-2"];
    const samples = new Map<string, { x: number; y: number }[]>(
      agents.map((name) => [name, []]),
    );
    for (let i = 0; i < 150; i++) {
      await stepFrames(page, 1);
      for (const name of agents) {
        const pos = await getEntityPosition(page, name);
        expect(pos).toBeDefined();
        samples.get(name)!.push(pos!);
      }
    }

    for (const name of agents) {
      const pts = samples.get(name)!;
      let maxTurn = 0;
      for (let i = 2; i < pts.length; i++) {
        const d1 = { x: pts[i - 1]!.x - pts[i - 2]!.x, y: pts[i - 1]!.y - pts[i - 2]!.y };
        const d2 = { x: pts[i]!.x - pts[i - 1]!.x, y: pts[i]!.y - pts[i - 1]!.y };
        const l1 = Math.hypot(d1.x, d1.y);
        const l2 = Math.hypot(d2.x, d2.y);
        if (l1 < 1 || l2 < 1) continue; // turning in place is allowed
        const cos = (d1.x * d2.x + d1.y * d2.y) / (l1 * l2);
        const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        maxTurn = Math.max(maxTurn, turn);
      }
      expect(maxTurn, `${name} max per-frame turn`).toBeLessThan(30);
    }
  });

  test("a boid flock's mean pairwise distance stays bounded", async ({ page }) => {
    await gotoFixture(page, "/steering.html");
    await waitForClock(page);
    const { boidNames } = await fixtureData(page);

    async function meanPairwiseDistance(): Promise<number> {
      const positions = await Promise.all(boidNames.map((name) => getEntityPosition(page, name)));
      for (const pos of positions) expect(pos).toBeDefined();
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
