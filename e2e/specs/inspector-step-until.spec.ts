import { expect, test, type Page } from "@playwright/test";
import { getSceneStack, gotoFixture } from "./helpers.js";

// A frozen scene push resolves on the microtask queue: `SceneManager.push`
// defers its work through `_pendingChain.then(...)`, so the transition can't
// even start until the call stack unwinds to the event loop. A synchronous
// `time.step(N)` loop never unwinds, so it can't drive one. `stepUntil` and
// `stepAsync` yield a real macrotask between frames, draining those microtasks
// so the push starts and finishes — all inside a single `page.evaluate`.

interface SceneApi {
  pushWithTransition(
    kind: "fade" | "flash" | "crossFade",
    duration: number,
  ): Promise<void>;
  getStackNames(): string[];
  getIsTransitioning(): boolean;
}

type Win = Window & { __sceneTransitionTest__?: SceneApi };

async function waitForSceneApi(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as Win).__sceneTransitionTest__ !== undefined,
  );
}

test.describe("Inspector async stepping (stepUntil / stepAsync)", () => {
  test("stepUntil drives a frozen scene push to completion inside one evaluate", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForSceneApi(page);
    expect(await getSceneStack(page)).toHaveLength(1);

    // Fire the push and await stepUntil in the SAME evaluate — only possible
    // because stepUntil yields between frames, so push()'s deferred transition
    // starts and finishes without breaking the loop across Playwright round-trips.
    const frames = await page.evaluate(async () => {
      const api = (window as Win).__sceneTransitionTest__!;
      const inspector = window.__yage__!.inspector;
      void api.pushWithTransition("fade", 0.1);
      return inspector.time.stepUntil(
        () => api.getStackNames().length === 2 && !api.getIsTransitioning(),
        { maxFrames: 120, dtMs: 16 },
      );
    });

    // It took real stepping, not an already-satisfied predicate.
    expect(frames).toBeGreaterThan(0);

    const stack = await getSceneStack(page);
    expect(stack).toHaveLength(2);
    expect(stack[1]?.name).toMatch(/scene-/);
  });

  test("a synchronous step(N) in one evaluate cannot even start the push", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForSceneApi(page);

    // The deadlock stepUntil removes: sync step() never unwinds to the event
    // loop, so push()'s queued microtask never runs within the evaluate — the
    // scene is not added and the transition never begins.
    const result = await page.evaluate(() => {
      const api = (window as Win).__sceneTransitionTest__!;
      const inspector = window.__yage__!.inspector;
      void api.pushWithTransition("fade", 0.1);
      inspector.time.step(60);
      return {
        stackLen: api.getStackNames().length,
        transitioning: api.getIsTransitioning(),
      };
    });

    expect(result.stackLen).toBe(1);
    expect(result.transitioning).toBe(false);
  });

  test("stepAsync advances a fixed frame count while draining async work", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForSceneApi(page);

    await page.evaluate(async () => {
      const api = (window as Win).__sceneTransitionTest__!;
      const inspector = window.__yage__!.inspector;
      void api.pushWithTransition("fade", 0.1);
      await inspector.time.stepAsync(30, { dtMs: 16 });
    });

    const stack = await getSceneStack(page);
    expect(stack).toHaveLength(2);
    expect(
      await page.evaluate(
        () => (window as Win).__sceneTransitionTest__!.getIsTransitioning(),
      ),
    ).toBe(false);
  });
});
