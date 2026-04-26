import { expect, test, type Page } from "@playwright/test";
import { getSceneStack, gotoFixture, stepFrames } from "./helpers";

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as Window & { __sceneTransitionTest__?: unknown })
        .__sceneTransitionTest__ !== undefined,
  );
}

interface SceneTransitionTestApi {
  pushWithTransition(
    kind: "fade" | "flash" | "crossFade",
    duration: number,
  ): Promise<void>;
  popWithTransition(duration: number): Promise<void>;
  replaceWithTransition(duration: number): Promise<void>;
  pushWithDefault(): Promise<void>;
  getTransitionEvents(): Array<{ type: "started" | "ended"; kind: string }>;
  getReplaceEventCount(): number;
  resetEvents(): void;
  getIsTransitioning(): boolean;
  getStackNames(): string[];
  getSceneAlpha(sceneIndex: number): number | null;
  clearAll(): void;
}

type Win = Window & { __sceneTransitionTest__: SceneTransitionTestApi };

/**
 * Synchronous API call — returns whatever the method returns (primitives or
 * arrays). Does NOT await returned Promises — critical for transition
 * methods, which only resolve once the frozen inspector clock has stepped past the
 * transition duration.
 */
function call<K extends keyof SceneTransitionTestApi>(
  page: Page,
  key: K,
  ...args: Parameters<SceneTransitionTestApi[K]>
): Promise<Awaited<ReturnType<SceneTransitionTestApi[K]>> | undefined> {
  return page.evaluate(
    ({ k, a }) => {
      const api = (window as Win).__sceneTransitionTest__;
      const fn = api[k as keyof SceneTransitionTestApi] as (
        ...args: unknown[]
      ) => unknown;
      const result = fn(...(a as unknown[]));
      // Fire-and-forget any returned Promise so page.evaluate doesn't wait
      // for transitions that require explicit inspector time steps to complete.
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(() => {});
        return undefined;
      }
      return result as unknown;
    },
    { k: key, a: args },
  ) as Promise<Awaited<ReturnType<SceneTransitionTestApi[K]>> | undefined>;
}

test.describe("Scene transitions", () => {
  test("push with fade transition toggles isTransitioning", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);

    let stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ name: "scene-a" });

    await call(page, "pushWithTransition", "fade", 100);

    await stepFrames(page, 1);
    expect(await call(page, "getIsTransitioning")).toBe(true);

    await stepFrames(page, 10, 16);

    stack = await getSceneStack(page);
    expect(stack).toHaveLength(2);
    expect(stack[1]?.name).toMatch(/scene-/);
  });

  test("isTransitioning is true during the run, false after it ends", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);

    await call(page, "pushWithTransition", "fade", 300);
    await stepFrames(page, 1, 16);
    expect(await call(page, "getIsTransitioning")).toBe(true);

    await stepFrames(page, 30, 16);
    expect(await call(page, "getIsTransitioning")).toBe(false);
  });

  test("emits started then ended events in order for a push", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);
    await call(page, "resetEvents");

    await call(page, "pushWithTransition", "fade", 100);
    await stepFrames(page, 20, 16);

    const events = await call(page, "getTransitionEvents");
    expect(events).toEqual([
      { type: "started", kind: "push" },
      { type: "ended", kind: "push" },
    ]);
  });

  test("queues back-to-back pushes and fires events in sequence", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);
    await call(page, "resetEvents");

    // Fire two pushes without awaiting between them.
    await page.evaluate(() => {
      const api = (window as Win).__sceneTransitionTest__;
      void api.pushWithTransition("fade", 100);
      void api.pushWithTransition("fade", 100);
    });

    // Drive the first transition to completion, yield so the queued push's
    // awaited preload / beforeEnter microtasks settle, then drive the
    // second.
    await stepFrames(page, 10, 16);
    await page.waitForFunction(
      () => (window as Win).__sceneTransitionTest__.getStackNames().length >= 2,
    );
    await stepFrames(page, 30, 16);
    await page.waitForFunction(
      () => (window as Win).__sceneTransitionTest__.getStackNames().length === 3,
    );

    const stack = await getSceneStack(page);
    expect(stack).toHaveLength(3);

    const events = await call(page, "getTransitionEvents");
    expect(events).toEqual([
      { type: "started", kind: "push" },
      { type: "ended", kind: "push" },
      { type: "started", kind: "push" },
      { type: "ended", kind: "push" },
    ]);
  });

  test("popAll queues after in-flight and pending transitions instead of cancelling them", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);
    await call(page, "resetEvents");

    // Start a transition, queue another, then enqueue popAll.
    await page.evaluate(() => {
      const api = (window as Win).__sceneTransitionTest__;
      void api.pushWithTransition("fade", 200);
      void api.pushWithTransition("fade", 100);
    });

    await stepFrames(page, 1, 16);
    expect(await call(page, "getIsTransitioning")).toBe(true);

    await call(page, "clearAll");

    // popAll is queued — in-flight transition keeps running.
    expect(await call(page, "getIsTransitioning")).toBe(true);
    expect((await getSceneStack(page)).length).toBeGreaterThan(0);

    // Drain each queued op in its own evaluate. stepFrames is a sync
    // loop inside a single page.evaluate, so microtasks only drain at
    // its boundaries — the second push can't start ticking until the
    // first push's transition promise resolves and the _pendingChain
    // advances, which happens between evaluates.
    await stepFrames(page, 15, 16); // drain 200ms fade
    await stepFrames(page, 10, 16); // drain 100ms fade
    await stepFrames(page, 1, 16); // let popAll microtask run

    expect(await getSceneStack(page)).toHaveLength(0);

    const events = await call(page, "getTransitionEvents");
    const started = events.filter((e) => e.type === "started");
    const ended = events.filter((e) => e.type === "ended");
    // Both pushes completed their transitions before popAll ran.
    expect(started).toHaveLength(2);
    expect(ended).toHaveLength(2);
  });

  test("replace keeps both scenes then removes old and emits scene:replaced once", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);
    // Push a second scene so we can replace the top.
    await call(page, "pushWithTransition", "fade", 100);
    await stepFrames(page, 20, 16);

    await call(page, "resetEvents");

    await call(page, "replaceWithTransition", 200);
    await stepFrames(page, 1, 16);

    // Frame 1 of replace: both scenes on stack.
    expect((await getSceneStack(page)).length).toBeGreaterThanOrEqual(2);

    await stepFrames(page, 30, 16);

    const stack = await getSceneStack(page);
    expect(stack).toHaveLength(2); // base scene-a + new replacement
    expect(await call(page, "getReplaceEventCount")).toBe(1);
  });

  test("per-scene defaultTransition animates without a call-site option", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);
    await call(page, "resetEvents");

    await call(page, "pushWithDefault");
    await stepFrames(page, 1, 16);

    expect(await call(page, "getIsTransitioning")).toBe(true);

    await stepFrames(page, 30, 16);
    expect(await call(page, "getIsTransitioning")).toBe(false);
    expect(await call(page, "getStackNames")).toContain("default-scene");
  });

  test("pop with transition removes scene only after transition ends", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);
    await call(page, "pushWithTransition", "fade", 100);
    await stepFrames(page, 20, 16);
    expect((await getSceneStack(page)).length).toBe(2);

    await call(page, "popWithTransition", 300);

    await stepFrames(page, 1, 16);
    // Still 2 scenes on stack while the transition runs.
    expect((await getSceneStack(page)).length).toBe(2);

    await stepFrames(page, 40, 16);
    expect((await getSceneStack(page)).length).toBe(1);
  });

  test("crossFade ramps both scenes' alpha at the midpoint", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);

    // Push scene-1 so we have two scenes to cross-dissolve between. Finish
    // this setup transition entirely so we only measure the next one.
    await call(page, "pushWithTransition", "fade", 100);
    await stepFrames(page, 20, 16);

    await call(page, "pushWithTransition", "crossFade", 400);
    // Step to ~half-way (≈200ms). crossFade clamps, so one frame past
    // midpoint is fine.
    await stepFrames(page, 13, 16);

    const fromAlpha = await call(page, "getSceneAlpha", 1);
    const toAlpha = await call(page, "getSceneAlpha", 2);
    expect(fromAlpha).not.toBeNull();
    expect(toAlpha).not.toBeNull();
    expect(fromAlpha!).toBeGreaterThan(0.3);
    expect(fromAlpha!).toBeLessThan(0.7);
    expect(toAlpha!).toBeGreaterThan(0.3);
    expect(toAlpha!).toBeLessThan(0.7);

    // Let it finish — both should return to alpha 1.
    await stepFrames(page, 20, 16);
    expect(await call(page, "getSceneAlpha", 2)).toBe(1);
  });

  test("popAll empties the stack after any in-flight transition finishes", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForTestApi(page);

    await call(page, "pushWithTransition", "fade", 100);
    await stepFrames(page, 1);
    await call(page, "clearAll");

    // Still transitioning — popAll hasn't started yet.
    expect((await getSceneStack(page)).length).toBeGreaterThan(0);

    // Finish the transition and let popAll run.
    await stepFrames(page, 15, 16);
    expect(await getSceneStack(page)).toHaveLength(0);
  });
});
