import { expect, test, type Page } from "@playwright/test";
import { gotoFixture, waitForClock } from "./helpers";

interface InputProbeData {
  jumpPressed: boolean;
  jumpJustPressed: boolean;
}

interface SceneApi {
  pushWithTransition(
    kind: "fade" | "flash" | "crossFade",
    duration: number,
  ): Promise<void>;
  getStackNames(): string[];
  getIsTransitioning(): boolean;
}

type Win = Window & { __sceneTransitionTest__: SceneApi };

async function waitForSceneApi(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as Window & { __sceneTransitionTest__?: SceneApi })
        .__sceneTransitionTest__ !== undefined,
  );
}

test.describe("Inspector.drive", () => {
  test("holds a key across frames and reports the outcome", async ({ page }) => {
    await gotoFixture(page, "/input.html");
    await waitForClock(page);

    const run = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const probe = (): InputProbeData =>
        inspector.getComponentData(
          "input-display",
          "InputProbe",
        ) as unknown as InputProbeData;

      return inspector.drive(async ({ input, step }) => {
        input.keyDown("Space");
        await step(1);
        const onPress = probe();
        await step(1);
        const held = probe();
        input.keyUp("Space");
        await step(1);
        return { onPress, held, released: probe() };
      });
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.onPress).toMatchObject({
      jumpPressed: true,
      jumpJustPressed: true,
    });
    expect(run.value.held).toMatchObject({
      jumpPressed: true,
      jumpJustPressed: false,
    });
    expect(run.value.released.jumpPressed).toBe(false);
    expect(run.framesUsed).toBe(3);
  });

  test("drives a scene push to completion, then leaves the clock as it found it", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-transitions.html");
    await waitForSceneApi(page);

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const api = (window as Win).__sceneTransitionTest__;
      // Start from a running clock, so the restore this asserts is a real one.
      inspector.time.thaw();
      const frozenBefore = inspector.time.isFrozen();
      let frozenDuring = false;

      const run = await inspector.drive(async ({ until }) => {
        frozenDuring = inspector.time.isFrozen();
        void api.pushWithTransition("fade", 0.1);
        return until(
          () => api.getStackNames().length === 2 && !api.getIsTransitioning(),
          { maxFrames: 120, dtMs: 16 },
        );
      });

      return {
        run,
        frozenBefore,
        frozenDuring,
        frozenAfter: inspector.time.isFrozen(),
        stack: api.getStackNames().length,
      };
    });

    expect(result.run.ok).toBe(true);
    if (!result.run.ok) return;
    // It took real stepping rather than an already-satisfied predicate.
    expect(result.run.value).toBeGreaterThan(0);
    expect(result.stack).toBe(2);
    // Frozen for the drive, running again afterwards.
    expect(result.frozenBefore).toBe(false);
    expect(result.frozenDuring).toBe(true);
    expect(result.frozenAfter).toBe(false);
  });

  test("reports a throw as a failed run and still restores the clock", async ({
    page,
  }) => {
    await gotoFixture(page, "/input.html");
    await waitForClock(page);

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const run = await inspector.drive(async ({ input, step }) => {
        input.keyDown("Space");
        await step(1);
        throw new Error("probe gave up");
      });
      return { run, frozen: inspector.time.isFrozen() };
    });

    expect(result.run.ok).toBe(false);
    if (result.run.ok) return;
    expect(result.run.error).toBe("probe gave up");
    // waitForClock froze it before the drive, so it stays frozen after.
    expect(result.frozen).toBe(true);
  });
});
