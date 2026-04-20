import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getSceneStack, gotoFixture } from "./helpers";

type LoadingTestHooks = {
  resolveAsset(path: string): boolean;
  failAsset(path: string, message: string): boolean;
  retry(): void;
  getProgressEvents(): number[];
  getDoneCount(): number;
  getErrors(): string[];
  reset(): Promise<void>;
};

function hook<K extends keyof LoadingTestHooks>(
  page: Page,
  key: K,
  ...args: Parameters<LoadingTestHooks[K]>
): Promise<ReturnType<LoadingTestHooks[K]>> {
  return page.evaluate(
    ({ key, args }) => {
      const h = (window as Window & { __loadingTest__?: LoadingTestHooks })
        .__loadingTest__;
      if (!h) throw new Error("__loadingTest__ not available");
      // @ts-expect-error — runtime dispatch over the hook record
      return h[key](...args);
    },
    { key, args } as { key: K; args: unknown[] },
  );
}

// Poll until the given asset has registered with the loader, then settle it.
// Avoids racing the initial `setTimeout(0)` yield at the top of `_run`.
async function settleAsset(
  page: Page,
  op: "resolveAsset" | "failAsset",
  path: string,
  message = "",
): Promise<void> {
  await page.waitForFunction(
    ({ op, path, message }) => {
      const h = (window as Window & { __loadingTest__?: LoadingTestHooks })
        .__loadingTest__;
      if (!h) return false;
      return op === "resolveAsset"
        ? h.resolveAsset(path)
        : h.failAsset(path, message);
    },
    { op, path, message },
  );
}

test.describe("LoadingScene fixture", () => {
  test("emits progress events and hands off to the target when preload completes", async ({
    page,
  }) => {
    await gotoFixture(page, "/loading-scene.html");

    let stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]?.name).toBe("boot-scene");

    await settleAsset(page, "resolveAsset", "a");
    await settleAsset(page, "resolveAsset", "b");
    await settleAsset(page, "resolveAsset", "c");

    await page.waitForFunction(
      () =>
        window.__yage__?.inspector.getSceneStack()[0]?.name === "game-scene",
    );

    stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]?.name).toBe("game-scene");

    const progress = await hook(page, "getProgressEvents");
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    }

    expect(await hook(page, "getDoneCount")).toBe(1);
    expect(await hook(page, "getErrors")).toEqual([]);
  });

  test("onLoadError fires on failure; retry via startLoading() recovers", async ({
    page,
  }) => {
    await gotoFixture(page, "/loading-scene.html");

    await settleAsset(page, "failAsset", "a", "disk went fishing");

    await page.waitForFunction(
      () =>
        (
          window as Window & { __loadingTest__?: LoadingTestHooks }
        ).__loadingTest__?.getErrors().length === 1,
    );
    expect(await hook(page, "getErrors")).toEqual(["disk went fishing"]);

    // Scene stayed mounted — no handoff happened.
    let stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]?.name).toBe("boot-scene");

    // Retry, then drain the fresh requests.
    await hook(page, "retry");
    await settleAsset(page, "resolveAsset", "a");
    await settleAsset(page, "resolveAsset", "b");
    await settleAsset(page, "resolveAsset", "c");

    await page.waitForFunction(
      () =>
        window.__yage__?.inspector.getSceneStack()[0]?.name === "game-scene",
    );

    stack = await getSceneStack(page);
    expect(stack[0]?.name).toBe("game-scene");
  });
});
