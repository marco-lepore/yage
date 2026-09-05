import { expect, test } from "@playwright/test";
import type { DebugDiagnostics } from "@yagejs/debug";
import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_WARMUP,
  EXAMPLE_SCRIPTS,
  type AtlasAction,
  type ExampleScript,
} from "./examples-atlas.js";

// Auto-discover every shipped example so new ones are covered without editing
// this file — mirrors how examples/vite.config.ts enumerates HTML inputs.
const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../examples");
const slugs = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".html") && f !== "index.html")
  .map((f) => f.slice(0, -".html".length))
  .sort();

// When set, write each example's stable JSON into this directory instead of
// comparing against a committed baseline. Used by the example-snapshot-diff
// workflow to capture one branch's output for a later cross-branch diff.
const dumpDir = process.env["EXAMPLE_SNAPSHOT_DIR"];
if (dumpDir) mkdirSync(dumpDir, { recursive: true });

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

      // Seed Math.random before any example code runs. The engine's own RNG is
      // seeded via DebugPlugin's deterministicSeed, but several examples scatter
      // entities with bare Math.random(); overriding it here (mulberry32) makes
      // their layout reproducible without rewriting the examples. Frozen-clock
      // execution is deterministic, so the call order — and thus the sequence —
      // is identical across runs.
      await page.addInitScript(() => {
        let s = 1 >>> 0;
        Math.random = () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      });

      await page.goto(`/${slug}.html?test`);

      // Wait until the engine is up, the clock is frozen at frame zero, AND a
      // user scene is on the stack. `?test` boots a startFrozen DebugPlugin, but
      // the scene is pushed *after* `engine.start()` resolves — waiting only on
      // isFrozen() races the push and can snapshot an empty scene.
      await page.waitForFunction(
        () => {
          const insp = window.__yage__?.inspector;
          return (
            insp?.time.isFrozen() === true && insp.getSceneStack().length > 0
          );
        },
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

      // Dump mode (example-snapshot-diff workflow): persist the stable JSON for
      // cross-branch diffing. Otherwise this is a smoke test — capturing the
      // snapshot exercises serialization, and the no-error assertion below
      // confirms the example boots and reaches a scene cleanly.
      if (dumpDir) {
        writeFileSync(join(dumpDir, `${slug}.json`), `${stablePretty(json)}\n`);
        // Also capture the rendered canvas so the diff workflow can do a
        // pixel comparison. Best-effort: behavioural truth lives in the JSON
        // snapshot; the image catches render-only regressions the inspector
        // state can't see (shaders, blend modes, z-order fallout, …).
        //
        // Hide the debug HUD's text readouts first — FPS and system timings
        // are wall-clock measurements that differ every run and would drown
        // real visual diffs in noise. World-space debug graphics (collider
        // outlines etc.) stay visible. setHudVisible re-renders the stage
        // synchronously, so the frozen clock never steps and the PNG shows
        // the same frame as the JSON above.
        await page.evaluate(() => {
          window
            .__yage__!.inspector.getExtension<DebugDiagnostics>("debug")
            ?.setHudVisible(false);
        });
        await page
          .locator("canvas")
          .first()
          .screenshot({ path: join(dumpDir, `${slug}.png`) });
      }

      expect(errors, `console/page errors in ${slug}`).toEqual([]);
    });
  }

  test("abilities-addon replaces active loadouts cleanly", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/abilities-addon.html?test");
    await page.waitForFunction(
      () => {
        const inspector = window.__yage__?.inspector;
        return (
          inspector?.time.isFrozen() === true &&
          inspector.getSceneStack().at(-1)?.name === "abilities-addon-demo"
        );
      },
      undefined,
      { timeout: 10_000 },
    );

    await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      inspector.events.clearLog();
      inspector.input.keyDown("ShiftLeft");
      await inspector.time.stepAsync(1);
      inspector.input.keyUp("ShiftLeft");
      await inspector.time.stepAsync(1);
    });

    const activeDash = await page.evaluate(
      () =>
        window.__yage__!.inspector.getComponentData(
          "hotbar-dash-time",
          "TextComponent",
        ) as { content: string },
    );
    expect(activeDash.content).not.toBe("0.0");

    const tapLoadout = (): Promise<number> =>
      page.evaluate(async () => {
        const inspector = window.__yage__!.inspector;
        const baseline = inspector.time.getFrame();
        inspector.input.keyDown("KeyE");
        await inspector.time.stepAsync(1);
        inspector.input.keyUp("KeyE");
        await inspector.time.stepAsync(1);
        return baseline;
      });
    const hudText = (): Promise<string> =>
      page.evaluate(
        () =>
          (
            window.__yage__!.inspector.getComponentData(
              "hud",
              "TextComponent",
            ) as { content: string }
          ).content,
      );

    const loadoutStartFrame = await tapLoadout();
    expect(await hudText()).toContain("LOADOUT KICKS");

    const resetDash = await page.evaluate(
      () =>
        window.__yage__!.inspector.getComponentData(
          "hotbar-dash-time",
          "TextComponent",
        ) as { content: string },
    );
    expect(resetDash.content).toBe("0.0");

    const endedDash = await page.evaluate(() =>
      window
        .__yage__!.inspector.events.getLog()
        .find(
          (event) =>
            event.source === "entity" && event.type === "ability:ended",
        ),
    );
    expect(endedDash?.frame).toBe(loadoutStartFrame + 1);

    for (const expected of ["FISTS", "KICKS", "FISTS"]) {
      await tapLoadout();
      expect(await hudText()).toContain(`LOADOUT ${expected}`);
    }

    expect(errors).toEqual([]);
  });

  test("abilities-addon distinguishes tap-dash from hold-run", async ({
    page,
  }) => {
    await page.goto("/abilities-addon.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector.getSceneStack().at(-1)?.name ===
        "abilities-addon-demo",
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      await inspector.time.stepAsync(1);
      const start = inspector.getEntityPosition("PlayerEntity")!;

      inspector.input.keyDown("KeyD");
      inspector.input.keyDown("ShiftLeft");
      await inspector.time.stepAsync(30);
      const runEnd = inspector.getEntityPosition("PlayerEntity")!;
      const runAnimation = (
        inspector.getComponentData("PlayerEntity", "AnimationController") as {
          current: string;
        }
      ).current;
      inspector.input.keyUp("ShiftLeft");
      inspector.input.keyUp("KeyD");
      await inspector.time.stepAsync(2);
      const heldDashCooldown = (
        inspector.getComponentData("hotbar-dash-time", "TextComponent") as {
          content: string;
        }
      ).content;

      inspector.input.keyDown("ShiftLeft");
      await inspector.time.stepAsync(1);
      inspector.input.keyUp("ShiftLeft");
      await inspector.time.stepAsync(2);
      const tappedDashCooldown = (
        inspector.getComponentData("hotbar-dash-time", "TextComponent") as {
          content: string;
        }
      ).content;

      return {
        distance: runEnd.x - start.x,
        runAnimation,
        heldDashCooldown,
        tappedDashCooldown,
        errors: inspector.getErrors(),
      };
    });

    expect(result.distance).toBeGreaterThan(105);
    expect(result.runAnimation).toBe("sprint_dir6");
    expect(result.heldDashCooldown).toBe("0.0");
    expect(result.tappedDashCooldown).not.toBe("0.0");
    expect(result.errors.callbackErrors).toEqual([]);
  });
});
