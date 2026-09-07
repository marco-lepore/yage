/**
 * Effect scoping, read from real canvas pixels at device pixel ratio 1 and 2.
 *
 * Covers `tree.addLayerEffect(factory, layers)` — one effect over a set of
 * layers behind one handle — and `renderAboveEffects` on a visual, which
 * draws it after the scene's layers, outside every layer- and scene-scope
 * filter and mask while its logical parent still drives its transform.
 */
import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { waitForClock, stepFrames } from "./helpers.js";

type RGB = [number, number, number];

interface EffectScopingApi {
  addLayerEffect(layers: string[]): void;
  addSceneEffect(): void;
  addScreenEffect(): void;
  removeEffects(): void;
  layerEffectError(layers: string[]): string | null;
  setAbove(names: string[], on: boolean): void;
  setLayer(name: string, layer: string): void;
  parentOf(name: string): { layer: string; parent: string | undefined };
  destroyRect(name: string): void;
  setSceneAlpha(alpha: number): void;
  setSceneVisible(visible: boolean): void;
  setSceneMask(x: number, y: number, radius: number): void;
  moveCamera(x: number, y: number): void;
}
type ApiWindow = Window & { __effectScoping__?: EffectScopingApi };

/** Call one fixture method, then let the frozen clock render the result. */
async function call<K extends keyof EffectScopingApi>(
  page: Page,
  method: K,
  ...args: Parameters<EffectScopingApi[K]>
): Promise<void> {
  await page.evaluate(
    ({ name, params }) => {
      const found = (window as ApiWindow).__effectScoping__;
      if (!found) throw new Error("__effectScoping__ is not available.");
      const target = found[name as keyof EffectScopingApi];
      (target as (...a: unknown[]) => void)(...params);
    },
    { name: method as string, params: args as unknown[] },
  );
  await stepFrames(page, 2);
}

async function shot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.locator("canvas").screenshot());
}

/** The pixel at a CSS-pixel coordinate. */
function px(png: PNG, x: number, y: number, dpr: number): RGB {
  const index = (Math.round(y * dpr) * png.width + Math.round(x * dpr)) * 4;
  return [png.data[index]!, png.data[index + 1]!, png.data[index + 2]!];
}

/** First CSS-pixel x on row `y` that is not background black, or -1. */
function firstLit(png: PNG, y: number, dpr: number): number {
  const row = Math.round(y * dpr);
  for (let x = 0; x < png.width; x++) {
    const index = (row * png.width + x) * 4;
    if (png.data[index]! + png.data[index + 1]! + png.data[index + 2]! > 30) {
      return x / dpr;
    }
  }
  return -1;
}

const near = (got: RGB, want: RGB, tolerance = 4): boolean =>
  got.every((value, i) => Math.abs(value - want[i]!) <= tolerance);

// Centres of the fixture's 100x100 rects, in CSS pixels.
const P = {
  bg: { x: 100, y: 100 }, // white, layer "bg"
  world: { x: 250, y: 100 }, // white, layer "world"
  fg: { x: 400, y: 100 }, // white, layer "fg"
  ui: { x: 550, y: 100 }, // blue, screen-space layer "ui"
  free: { x: 250, y: 300 }, // white, layer "world", nothing above it
  covered: { x: 550, y: 300 }, // white, layer "world", under a "ui" rect
  optioned: { x: 700, y: 300 }, // as `covered`, but lifted via the option
};
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [255, 0, 0];
const BLUE: RGB = [0, 0, 255];
const BLACK: RGB = [0, 0, 0];

function suite(dpr: number): void {
  test.describe(`dpr ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test.beforeEach(async ({ page }) => {
      await page.goto("/effect-scoping.html");
      await waitForClock(page);
      await page.waitForFunction(
        () => (window as ApiWindow).__effectScoping__ !== undefined,
      );
      await stepFrames(page, 2);
    });

    test("baseline: the option lifts a visual above the UI rect over it", async ({
      page,
    }) => {
      const s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(WHITE);
      expect(px(s, P.world.x, P.world.y, dpr)).toEqual(WHITE);
      expect(px(s, P.fg.x, P.fg.y, dpr)).toEqual(WHITE);
      expect(px(s, P.ui.x, P.ui.y, dpr)).toEqual(BLUE);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(WHITE);
      // No flag: the screen-space rect wins.
      expect(px(s, P.covered.x, P.covered.y, dpr)).toEqual(BLUE);
      // `renderAboveEffects: true` on the component: it draws last.
      expect(px(s, P.optioned.x, P.optioned.y, dpr)).toEqual(WHITE);
    });

    test("addLayerEffect covers exactly the listed layers", async ({
      page,
    }) => {
      await call(page, "addLayerEffect", ["bg", "world"]);
      let s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(RED);
      expect(px(s, P.world.x, P.world.y, dpr)).toEqual(RED);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(RED);
      expect(px(s, P.fg.x, P.fg.y, dpr)).toEqual(WHITE);
      expect(px(s, P.ui.x, P.ui.y, dpr)).toEqual(BLUE);

      // One handle removes every layer's pass.
      await call(page, "removeEffects");
      s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(WHITE);
      expect(px(s, P.world.x, P.world.y, dpr)).toEqual(WHITE);
    });

    test("addLayerEffect rejects an empty list and an unknown layer", async ({
      page,
    }) => {
      const empty = await page.evaluate(() =>
        (window as ApiWindow).__effectScoping__!.layerEffectError([]),
      );
      expect(empty).toBe(
        "SceneRenderTree.addLayerEffect: layers must name at least one layer, got [].",
      );

      const unknown = await page.evaluate(() =>
        (window as ApiWindow).__effectScoping__!.layerEffectError([
          "world",
          "nope",
        ]),
      );
      expect(unknown).toContain('unknown layer "nope"');

      // Nothing was attached by the rejected calls.
      await stepFrames(page, 2);
      const s = await shot(page);
      expect(px(s, P.world.x, P.world.y, dpr)).toEqual(WHITE);
    });

    test("a lifted visual escapes the scene-scope filter that covers the UI", async ({
      page,
    }) => {
      await call(page, "addSceneEffect");
      let s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(RED);
      expect(px(s, P.ui.x, P.ui.y, dpr)).toEqual(BLACK); // blue through red-only
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(RED);

      await call(page, "setAbove", ["free", "covered"], true);
      s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(RED);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(WHITE);
      expect(px(s, P.covered.x, P.covered.y, dpr)).toEqual(WHITE);

      // The logical parent is unchanged — only the draw order moved.
      const logical = await page.evaluate(() =>
        (window as ApiWindow).__effectScoping__!.parentOf("free"),
      );
      expect(logical).toEqual({ layer: "world", parent: "world" });
    });

    test("a lifted visual escapes a filter on its own layer", async ({
      page,
    }) => {
      await call(page, "setAbove", ["free"], true);
      await call(page, "addLayerEffect", ["world"]);
      const s = await shot(page);
      expect(px(s, P.world.x, P.world.y, dpr)).toEqual(RED);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(WHITE);
    });

    test("a screen-scope filter still covers a lifted visual", async ({
      page,
    }) => {
      await call(page, "setAbove", ["free"], true);
      await call(page, "addScreenEffect");
      const s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(RED);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(RED);
    });

    test("a lifted visual keeps the scene's alpha and visibility", async ({
      page,
    }) => {
      await call(page, "setAbove", ["free"], true);
      await call(page, "setSceneAlpha", 0.5);
      let s = await shot(page);
      expect(near(px(s, P.bg.x, P.bg.y, dpr), [128, 128, 128])).toBe(true);
      expect(near(px(s, P.free.x, P.free.y, dpr), [128, 128, 128])).toBe(true);

      await call(page, "setSceneAlpha", 1);
      await call(page, "setSceneVisible", false);
      s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(BLACK);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(BLACK);
    });

    test("the camera moves a lifted visual with its layer", async ({
      page,
    }) => {
      await call(page, "setAbove", ["free"], true);
      await call(page, "moveCamera", 400, 300); // centred: identity
      const before = await shot(page);
      expect(
        Math.abs(firstLit(before, P.world.y, dpr) - 50),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(firstLit(before, P.free.y, dpr) - 200),
      ).toBeLessThanOrEqual(1);

      await call(page, "moveCamera", 350, 300); // world shifts +50
      const after = await shot(page);
      expect(
        Math.abs(firstLit(after, P.world.y, dpr) - 100),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(firstLit(after, P.free.y, dpr) - 250),
      ).toBeLessThanOrEqual(1);
    });

    test("a scene mask clips the layers but not a lifted visual", async ({
      page,
    }) => {
      await call(page, "setAbove", ["free"], true);
      await call(page, "setSceneMask", 100, 100, 80); // a circle around "bg"
      const s = await shot(page);
      expect(px(s, P.bg.x, P.bg.y, dpr)).toEqual(WHITE);
      expect(px(s, P.world.x, P.world.y, dpr)).toEqual(BLACK);
      expect(px(s, P.ui.x, P.ui.y, dpr)).toEqual(BLACK);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(WHITE);
    });

    test("a lifted visual stays lifted after setLayer re-parents it", async ({
      page,
    }) => {
      await call(page, "addSceneEffect");
      await call(page, "setAbove", ["free"], true);
      await call(page, "setLayer", "free", "fg");
      const s = await shot(page);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(WHITE);
      const logical = await page.evaluate(() =>
        (window as ApiWindow).__effectScoping__!.parentOf("free"),
      );
      expect(logical).toEqual({ layer: "fg", parent: "fg" });

      await call(page, "setAbove", ["free"], false);
      expect(px(await shot(page), P.free.x, P.free.y, dpr)).toEqual(RED);
    });

    test("turning the flag off restores filtering and draw order", async ({
      page,
    }) => {
      await call(page, "addSceneEffect");
      await call(page, "setAbove", ["free", "covered"], true);
      await call(page, "setAbove", ["free", "covered"], false);
      const s = await shot(page);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(RED);
      // The "ui" rect (blue → black under red-only) covers it again.
      expect(px(s, P.covered.x, P.covered.y, dpr)).toEqual(BLACK);
    });

    test("destroying a lifted visual leaves no error behind", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });

      await call(page, "setAbove", ["free"], true);
      await call(page, "destroyRect", "free");
      await stepFrames(page, 2);

      const s = await shot(page);
      expect(px(s, P.free.x, P.free.y, dpr)).toEqual(BLACK);
      expect(errors).toEqual([]);
    });
  });
}

suite(1);
suite(2);
