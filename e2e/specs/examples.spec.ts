import { expect, test } from "@playwright/test";
import { readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_WARMUP,
  EXAMPLE_SCRIPTS,
  type AtlasAction,
  type ExampleScript,
} from "./examples-atlas";

// Auto-discover every shipped example so new ones are covered without editing
// this file — mirrors how examples/vite.config.ts enumerates HTML inputs.
const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../examples");
const slugs = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".html") && f !== "index.html")
  .map((f) => f.slice(0, -".html".length))
  .sort();

/** Deterministic key-sorted pretty JSON, so snapshot diffs stay readable. */
function stablePretty(json: string): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(JSON.parse(json)), null, 2);
}

test.describe("Examples", () => {
  for (const slug of slugs) {
    const script: ExampleScript = EXAMPLE_SCRIPTS[slug] ?? {};

    test(slug, async ({ page }) => {
      test.skip(script.skip === true, script.reason ?? "skipped by atlas");

      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));

      await page.goto(`/${slug}.html?test`);

      // Wait until the engine is up and the clock is frozen at frame zero —
      // `?test` boots a startFrozen DebugPlugin, so this confirms the time
      // controller is attached before we drive it.
      await page.waitForFunction(
        () => window.__yage__?.inspector?.time.isFrozen() === true,
        undefined,
        { timeout: 10_000 },
      );

      // Replay the script in-page against the inspector.
      await page.evaluate(
        ({ warmup, actions }) => {
          const insp = window.__yage__!.inspector;
          if (warmup > 0) insp.time.step(warmup);
          for (const a of actions as AtlasAction[]) {
            if ("step" in a) insp.time.step(a.step);
            else if ("tap" in a) insp.input.tap(a.tap, a.frames ?? 1);
            else if ("hold" in a) insp.input.hold(a.hold, a.frames);
            else if ("keyDown" in a) insp.input.keyDown(a.keyDown);
            else if ("keyUp" in a) insp.input.keyUp(a.keyUp);
            else if ("action" in a)
              insp.input.fireAction(a.action, a.frames ?? 1);
            else if ("pointerMove" in a)
              insp.input.pointerMove(a.pointerMove[0], a.pointerMove[1]);
            else if ("click" in a) {
              insp.input.mouseMove(a.click[0], a.click[1]);
              insp.input.mouseDown(a.button ?? 0);
              insp.time.step(1);
              insp.input.mouseUp(a.button ?? 0);
              insp.time.step(1);
            }
          }
        },
        {
          warmup: script.warmup ?? DEFAULT_WARMUP,
          actions: script.actions ?? [],
        },
      );

      const json = await page.evaluate(() =>
        window.__yage__!.inspector.snapshotJSON(),
      );
      expect(stablePretty(json)).toMatchSnapshot(`${slug}.json`);

      if (script.screenshot) {
        const b64 = await page.evaluate(() =>
          window.__yage__!.inspector.capture.pngBase64(),
        );
        expect(Buffer.from(b64, "base64")).toMatchSnapshot(`${slug}.png`);
      }

      expect(errors, `console/page errors in ${slug}`).toEqual([]);
    });
  }
});
