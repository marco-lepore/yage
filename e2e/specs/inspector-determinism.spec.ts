import { expect, test } from "@playwright/test";
import { waitForClock, waitForInspector } from "./helpers";

test.describe("Inspector determinism", () => {
  test("replay snapshots stay bit-identical across repeated runs", async ({
    page,
  }) => {
    const runs: string[] = [];

    for (let i = 0; i < 10; i++) {
      await page.goto("/platformer.html");
      await waitForInspector(page);
      await waitForClock(page);
      await page.waitForFunction(
        () => window.__yage__?.inspector.getSceneStack()[0]?.name === "platformer",
      );

      const snapshot = await page.evaluate(async () => {
        const inspector = window.__yage__?.inspector;
        if (!inspector) {
          throw new Error("__yage__.inspector is not available.");
        }

        inspector.setSeed(42);
        inspector.input.clearAll();

        await inspector.input.hold("ArrowRight", 30);
        await inspector.input.fireAction("jump", 1);
        await inspector.time.step(60);

        return inspector.snapshotJSON();
      });

      runs.push(snapshot);
    }

    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toBe(runs[0]);
    }
  });
});
