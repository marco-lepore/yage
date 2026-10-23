import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LootResult } from "@yagejs-addons/loot";
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

      // Replay the script in-page as one drive. Only its final frame is
      // drawn: the snapshot reads engine state, and the one draw still runs
      // the render path and gives dump mode its screenshot.
      const replay = await page.evaluate(
        async ({ warmup, actions }) => {
          const run = await window.__yage__!.inspector.drive(
            async ({ step, input }) => {
              if (warmup > 0) await step(warmup);
              for (const a of actions as AtlasAction[]) {
                if ("step" in a) await step(a.step);
                else if ("tap" in a) await input.tap(a.tap, a.frames ?? 1);
                else if ("hold" in a) await input.hold(a.hold, a.frames);
                else if ("keyDown" in a) input.keyDown(a.keyDown);
                else if ("keyUp" in a) input.keyUp(a.keyUp);
                else if ("action" in a)
                  await input.fireAction(a.action, a.frames ?? 1);
                else if ("pointerMove" in a)
                  input.pointerMove(a.pointerMove[0], a.pointerMove[1]);
                else if ("click" in a) {
                  input.mouseMove(a.click[0], a.click[1]);
                  input.mouseDown(a.button ?? 0);
                  await step(1);
                  input.mouseUp(a.button ?? 0);
                  await step(1);
                }
              }
            },
            { render: "last" },
          );
          return run.ok ? null : run.error;
        },
        {
          warmup: script.warmup ?? DEFAULT_WARMUP,
          actions: script.actions ?? [],
        },
      );
      expect(replay, `replay of ${slug}`).toBeNull();

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

      // A NaN camera position draws every world-space layer off-screen while
      // the example otherwise runs without errors. JSON writes NaN as null.
      const { camera } = JSON.parse(json) as {
        camera: { position: { x: number | null; y: number | null } } | null;
      };
      if (camera) {
        expect(
          Number.isFinite(camera.position.x) &&
            Number.isFinite(camera.position.y),
          `finite camera position in ${slug}`,
        ).toBe(true);
      }
    });
  }

  test("platformer jump reaches its full height", async ({ page }) => {
    await page.goto("/platformer.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector?.getSceneStack().at(-1)?.name ===
        "platformer",
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      // Let the player fall from the spawn point and land.
      await inspector.time.stepAsync(90, { render: "none" });
      const groundY = inspector.getEntityPosition("PlayerEntity")!.y;

      inspector.input.keyDown("Space");
      await inspector.time.stepAsync(1, { render: "none" });
      inspector.input.keyUp("Space");
      let apexY = groundY;
      for (let frame = 0; frame < 60; frame++) {
        await inspector.time.stepAsync(1, { render: "none" });
        apexY = Math.min(apexY, inspector.getEntityPosition("PlayerEntity")!.y);
      }

      return { height: groundY - apexY, errors: inspector.getErrors() };
    });

    // A 505 px/s jump against 980 px/s² gravity peaks near 130 px.
    expect(result.height).toBeGreaterThan(120);
    expect(result.errors.callbackErrors).toEqual([]);
  });

  test("character-controller drops through a one-way platform", async ({
    page,
  }) => {
    await page.goto("/character-controller.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector?.getSceneStack().at(-1)?.name ===
        "character-controller",
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const feetY = () => inspector.getEntityPosition("PlayerEntity")!.y;
      await inspector.time.stepAsync(60, { render: "none" });
      const floorY = feetY();
      // Run right and jump onto the first one-way platform.
      inspector.input.keyDown("KeyD");
      await inspector.time.stepAsync(20, { render: "none" });
      inspector.input.keyDown("Space");
      await inspector.time.stepAsync(30, { render: "none" });
      inspector.input.keyUp("Space");
      await inspector.time.stepAsync(5, { render: "none" });
      inspector.input.keyUp("KeyD");
      await inspector.time.stepAsync(40, { render: "none" });
      const platformY = feetY();
      // Down plus jump drops through it.
      inspector.input.keyDown("KeyS");
      inspector.input.keyDown("Space");
      await inspector.time.stepAsync(2, { render: "none" });
      inspector.input.keyUp("Space");
      inspector.input.keyUp("KeyS");
      await inspector.time.stepAsync(40, { render: "none" });
      return {
        floorY,
        platformY,
        droppedY: feetY(),
        errors: inspector.getErrors(),
      };
    });

    // The first one-way platform's top is 96 px above the floor.
    expect(result.floorY - result.platformY).toBeCloseTo(96, 0);
    expect(result.droppedY).toBeCloseTo(result.floorY, 0);
    expect(result.errors.callbackErrors).toEqual([]);
  });

  test("character-controller catches and climbs a ledge", async ({ page }) => {
    await page.goto("/character-controller.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector?.getSceneStack().at(-1)?.name ===
        "character-controller",
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const position = () => inspector.getEntityPosition("PlayerEntity")!;
      const hanging = () =>
        (
          inspector.getComponentData("PlayerEntity", "LedgeClimb") as {
            hanging: boolean;
          }
        ).hanging;
      // "]" respawns the player at the next zone; zone 6 is the ledge.
      for (let zone = 1; zone < 6; zone++) {
        await inspector.input.tap("BracketRight");
        await inspector.time.stepAsync(1, { render: "none" });
      }
      await inspector.time.stepAsync(30, { render: "none" });
      // Run toward the block, jump, and keep holding toward it.
      inspector.input.keyDown("KeyD");
      await inspector.time.stepUntil(() => position().x >= 3555, {
        maxFrames: 120,
        render: "none",
      });
      inspector.input.keyDown("Space");
      await inspector.time.stepUntil(hanging, {
        maxFrames: 60,
        render: "none",
      });
      inspector.input.keyUp("Space");
      const hang = { ...position(), hanging: hanging() };
      await inspector.time.stepAsync(20, { render: "none" });
      const stillHanging = hanging();
      // Jump climbs onto the block.
      await inspector.input.tap("Space");
      await inspector.time.stepAsync(40, { render: "none" });
      inspector.input.keyUp("KeyD");
      return {
        hang,
        stillHanging,
        end: position(),
        errors: inspector.getErrors(),
      };
    });

    // The block's top is 130 px above the floor, at y = 410.
    expect(result.hang.hanging).toBe(true);
    expect(result.stillHanging).toBe(true);
    expect(result.end.y).toBeCloseTo(409.5, 0);
    expect(result.end.x).toBeGreaterThan(3620);
    expect(result.errors.callbackErrors).toEqual([]);
  });

  test("loading-scene hands off to the game once its assets load", async ({
    page,
  }) => {
    await page.goto("/loading-scene.html?test");
    await page.waitForFunction(
      () => window.__yage__?.inspector?.getSceneStack().at(-1)?.name === "boot",
      undefined,
      { timeout: 10_000 },
    );

    // The fake loader waits on engine time, so the frozen clock holds the
    // load until frames are stepped. stepUntil yields between frames, which
    // lets the loader's promises settle.
    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const frames = await inspector.time.stepUntil(
        () => {
          const stack = inspector.getSceneStack();
          return stack.length === 1 && stack[0]?.name === "game";
        },
        { maxFrames: 300, render: "none" },
      );
      return { frames, errors: inspector.getErrors() };
    });

    // The slowest asset takes 0.85 s, then the fade out runs.
    expect(result.frames).toBeGreaterThan(40);
    expect(result.errors.callbackErrors).toEqual([]);
  });

  test("render-targets moves the radar on its layer and stops redrawing while paused", async ({
    page,
  }) => {
    await page.goto("/render-targets.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector?.getSceneStack().at(-1)?.name ===
        "render-targets",
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const read = () => ({
        contact: inspector.getEntityPosition("ContactEntity")!,
        redraws: (
          inspector.getComponentData("RadarEntity", "RadarScan") as {
            redraws: number;
          }
        ).redraws,
      });
      await inspector.time.stepAsync(10, { render: "none" });
      const running = read();
      await inspector.time.stepAsync(10, { render: "none" });
      const later = read();
      inspector.input.keyDown("Space");
      await inspector.time.stepAsync(1, { render: "none" });
      inspector.input.keyUp("Space");
      const paused = read();
      await inspector.time.stepAsync(10, { render: "none" });
      const stillPaused = read();
      return {
        running,
        later,
        paused,
        stillPaused,
        errors: inspector.getErrors(),
      };
    });

    expect(result.later.contact).not.toEqual(result.running.contact);
    expect(result.later.redraws - result.running.redraws).toBe(10);
    expect(result.stillPaused.contact).toEqual(result.paused.contact);
    expect(result.stillPaused.redraws).toBe(result.paused.redraws);
    expect(result.errors.callbackErrors).toEqual([]);
  });

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
      await inspector.time.stepAsync(1, { render: "none" });
      inspector.input.keyUp("ShiftLeft");
      await inspector.time.stepAsync(1, { render: "none" });
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
        await inspector.time.stepAsync(1, { render: "none" });
        inspector.input.keyUp("KeyE");
        await inspector.time.stepAsync(1, { render: "none" });
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
        window.__yage__?.inspector?.getSceneStack().at(-1)?.name ===
        "abilities-addon-demo",
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      await inspector.time.stepAsync(1, { render: "none" });
      const start = inspector.getEntityPosition("PlayerEntity")!;

      inspector.input.keyDown("KeyD");
      inspector.input.keyDown("ShiftLeft");
      await inspector.time.stepAsync(30, { render: "none" });
      const runEnd = inspector.getEntityPosition("PlayerEntity")!;
      const runAnimation = (
        inspector.getComponentData("PlayerEntity", "AnimationController") as {
          current: string;
        }
      ).current;
      inspector.input.keyUp("ShiftLeft");
      inspector.input.keyUp("KeyD");
      await inspector.time.stepAsync(2, { render: "none" });
      const heldDashCooldown = (
        inspector.getComponentData("hotbar-dash-time", "TextComponent") as {
          content: string;
        }
      ).content;

      inspector.input.keyDown("ShiftLeft");
      await inspector.time.stepAsync(1, { render: "none" });
      inspector.input.keyUp("ShiftLeft");
      await inspector.time.stepAsync(2, { render: "none" });
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

  test("hotbar drives abilities, a held beam and inventory items", async ({
    page,
  }) => {
    await page.goto("/hotbar.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector?.getSceneStack().at(-1)?.name === "hotbar",
      undefined,
      { timeout: 10_000 },
    );

    // Hold a key for `frames`, let go, wait `after` frames, then read the
    // state the assertions need. One evaluate per press keeps each page
    // promise short.
    const press = (code: string, frames = 1, after = 2) =>
      page.evaluate(
        async ({ code, frames, after }) => {
          const inspector = window.__yage__!.inspector;
          inspector.input.keyDown(code);
          await inspector.time.stepAsync(frames, { render: "none" });
          inspector.input.keyUp(code);
          await inspector.time.stepAsync(after, { render: "none" });
          const read = <T>(entity: string, component: string) =>
            inspector.getComponentData(entity, component) as T;
          return {
            result: read<{
              diagnostic: { lastActivation: { result: unknown } | null };
            }>("PlayerEntity", "HotbarController").diagnostic.lastActivation
              ?.result,
            damage: read<{ damageTaken: number }>("TargetEntity", "Dummy")
              .damageTaken,
            potions: read<{ potions: number }>("PlayerEntity", "Backpack")
              .potions,
            x: inspector.getEntityPosition("PlayerEntity")!.x,
            errors: inspector.getErrors().callbackErrors,
          };
        },
        { code, frames, after },
      );

    const zap = await press("Digit1");
    // Wait out Zap's 0.3 s run so the beam finds the lane free.
    const retry = await press("Digit1", 1, 20);
    // Hold the beam for one second: base 10 plus 30 per charged second.
    const beam = await press("Digit2", 60, 10);
    const walk = await press("KeyD", 30);
    const potion = await press("Digit3");

    expect(zap.damage).toBe(15);
    expect(retry.result).toEqual({ ok: false, reason: "cooldown" });
    expect(beam.damage - zap.damage).toBeGreaterThanOrEqual(39);
    expect(beam.damage - zap.damage).toBeLessThanOrEqual(41);
    expect(walk.x - beam.x).toBeGreaterThan(100);
    // Health starts below full, so the bag offers "drink".
    expect(potion.result).toEqual({ ok: true });
    expect(walk.potions - potion.potions).toBe(1);
    expect(potion.errors).toEqual([]);
  });

  test("hotbar holds a slot by pointer and swaps slots in edit mode", async ({
    page,
  }) => {
    await page.goto("/hotbar.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector?.getSceneStack().at(-1)?.name === "hotbar",
      undefined,
      { timeout: 10_000 },
    );

    // Slot centers on the 800×500 canvas: five 130 px slots with 8 px gaps,
    // centered, 24 px above the bottom edge.
    const slotX = (slot: number) => 59 + slot * 138 + 65;
    const slotY = 426;
    type Step =
      | { move: [number, number] }
      | { down: true }
      | { up: true }
      | { key: string }
      | { frames: number };
    const run = (steps: Step[]) =>
      page.evaluate(async (steps) => {
        const inspector = window.__yage__!.inspector;
        for (const step of steps) {
          if ("move" in step) inspector.input.pointerMove(...step.move);
          else if ("down" in step) inspector.input.pointerDown(0);
          else if ("up" in step) inspector.input.pointerUp(0);
          else if ("key" in step) await inspector.input.tap(step.key);
          else await inspector.time.stepAsync(step.frames, { render: "none" });
        }
        const read = <T>(entity: string, component: string) =>
          inspector.getComponentData(entity, component) as T;
        return {
          damage: read<{ damageTaken: number }>("TargetEntity", "Dummy")
            .damageTaken,
          slots: read<{
            diagnostic: { slots: { bindingId: string | null }[] };
          }>("PlayerEntity", "HotbarController").diagnostic.slots.map(
            (slot) => slot.bindingId,
          ),
          errors: inspector.getErrors().callbackErrors,
        };
      }, steps);

    // Play mode: pressing the Beam slot charges it until the pointer lifts.
    const held = await run([
      { move: [slotX(1), slotY] },
      { down: true },
      { frames: 60 },
      { up: true },
      { frames: 10 },
    ]);
    expect(held.damage).toBeGreaterThanOrEqual(39);
    expect(held.damage).toBeLessThanOrEqual(41);

    // Edit mode: dragging Zap onto Beam swaps them and activates nothing.
    const swapped = await run([
      { key: "KeyE" },
      { frames: 2 },
      { move: [slotX(0), slotY] },
      { down: true },
      { frames: 1 },
      { move: [slotX(1), slotY] },
      { frames: 1 },
      { up: true },
      { frames: 2 },
    ]);
    expect(swapped.slots.slice(0, 2)).toEqual(["beam", "zap"]);
    expect(swapped.damage).toBe(held.damage);
    expect(swapped.errors).toEqual([]);
  });

  test("yarn-dialogue plays a Yarn project, switches language, and runs commands", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/yarn-dialogue.html?test");
    await page.waitForFunction(
      () => {
        const insp = window.__yage__?.inspector;
        return (
          insp?.time.isFrozen() === true &&
          insp.getSceneStack().at(-1)?.name === "yarn-tavern"
        );
      },
      undefined,
      { timeout: 10_000 },
    );

    interface Probe {
      lastLine: string;
      lines: number;
      coins: number;
      locale: string;
      active: boolean;
      choosing: boolean;
    }
    const probe = () =>
      page.evaluate(
        () =>
          window.__yage__!.inspector.getComponentData(
            "tavern-probe",
            "TavernProbe",
          ) as Probe,
      );
    const tap = (code: string) =>
      page.evaluate(async (code) => {
        const insp = window.__yage__!.inspector;
        insp.input.keyDown(code);
        await insp.time.stepAsync(1, { render: "none" });
        insp.input.keyUp(code);
        await insp.time.stepAsync(3, { render: "none" });
      }, code);
    const until = (check: string) =>
      page.waitForFunction((check) => {
        const p = window.__yage__!.inspector.getComponentData(
          "tavern-probe",
          "TavernProbe",
        ) as Record<string, unknown>;
        return new Function("p", `return ${check}`)(p) === true;
      }, check);

    await page.evaluate(() =>
      window.__yage__!.inspector.time.stepAsync(5, { render: "none" }),
    );
    const first = await probe();
    expect(first.locale).toBe("en");
    expect(first.coins).toBe(7);
    expect(first.lastLine).toBe(
      "Barkeep: Welcome to the Crooked Lantern, traveller!",
    );

    // L switches to Italian in place: no line is replayed.
    await tap("KeyL");
    expect(await probe()).toMatchObject({ locale: "it", lines: first.lines });

    // Enter completes the reveal, Enter again moves on — in Italian now.
    await tap("Enter");
    await tap("Enter");
    await until('p.lastLine === "Barkeep: Cosa ti porto?"');
    await tap("Enter");
    await tap("Enter");
    await until("p.choosing === true");

    // The first option orders a drink: `<<pay {$price}>>` spends 3 coins.
    await tap("Enter");
    await until(
      'p.lastLine === "Barkeep: Una Birra della Lanterna, arriva subito."',
    );
    expect((await probe()).coins).toBe(4);

    // Past the ale and its one-second `<<wait>>`, back to the menu. The steps
    // stop as the menu line starts, so the next Enter completes its reveal.
    await tap("Enter");
    await tap("Enter");
    await page.evaluate(async () => {
      const insp = window.__yage__!.inspector;
      await insp.time.stepUntil(
        () =>
          (insp.getComponentData("tavern-probe", "TavernProbe") as Probe)
            .lastLine === "Barkeep: Cosa ti porto?",
        { maxFrames: 120, render: "none" },
      );
    });
    await tap("Enter");
    await tap("Enter");
    await until("p.choosing === true");

    // "Ascolta il bardo" is the second option: intro, one song, thanks.
    await tap("ArrowDown");
    await tap("Enter");
    await until('p.lastLine === "Bard: Una canzone per la sala!"');
    await tap("Enter");
    await tap("Enter");
    await tap("Enter");
    await tap("Enter");
    await until('p.lastLine === "Bard: Grazie, grazie!"');
    await tap("Enter");
    await tap("Enter");
    // Right after the song the barkeep asks about it.
    await until('p.lastLine === "Barkeep: Ti è piaciuta la canzone?"');
    await tap("Enter");
    await tap("Enter");
    await until("p.choosing === true");

    // "Buonanotte" is the fourth option; it ends the conversation.
    await tap("ArrowDown");
    await tap("ArrowDown");
    await tap("ArrowDown");
    await tap("Enter");
    await until('p.lastLine === "Barkeep: Buon viaggio!"');
    await tap("Enter");
    await tap("Enter");
    await until("p.active === false");

    // Talking again runs the Greeting node group: the `when: once` welcome is
    // spent and 4 coins isn't a light purse, so the `when: always` line plays.
    await tap("KeyT");
    await until('p.lastLine === "Barkeep: Di nuovo qui? Prendi uno sgabello."');
    // The song was last conversation, so the menu opens with the usual line.
    await tap("Enter");
    await tap("Enter");
    await until('p.lastLine === "Barkeep: Cosa ti porto?"');

    const inspectorErrors = await page.evaluate(
      () => window.__yage__!.inspector.getErrors().callbackErrors,
    );
    expect(inspectorErrors).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("localization switches visible text without replaying gameplay", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/i18n.html?test");
    await page.waitForFunction(
      () => {
        const insp = window.__yage__?.inspector;
        return (
          insp?.time.isFrozen() === true &&
          insp.getSceneStack().at(-1)?.name === "localization-example"
        );
      },
      undefined,
      { timeout: 10_000 },
    );

    interface Probe {
      locale: string;
      paused: boolean;
      dialogueActive: boolean;
      dialogueLines: number;
      dialogueCommands: number;
      dialogueCompletions: number;
      dialogueChoices: number;
      dialogueChoosing: boolean;
      inventoryActions: number;
      inventoryOpen: boolean;
      inventoryMenuOpen: boolean;
      inventoryQuantity: number;
      inventorySelection: number;
    }
    const state = () =>
      page.evaluate(() => {
        const inspector = window.__yage__!.inspector;
        return {
          probe: inspector.getComponentData(
            "localization-probe",
            "LocalizationProbe",
          ) as Probe,
          renderer: inspector.getComponentData(
            "renderer-localized",
            "LocalizedTextComponent",
          ) as { content: string },
          fallback: inspector.getComponentData(
            "literal-and-fallback",
            "LocalizedTextComponent",
          ) as { content: string },
          errors: inspector.getErrors(),
        };
      });
    // Tap a key for one frozen-clock frame, then let a few frames run so the
    // controllers' bindings and the dialogue's async line steps settle.
    const tap = (code: string) =>
      page.evaluate(async (code) => {
        const insp = window.__yage__!.inspector;
        insp.input.keyDown(code);
        await insp.time.stepAsync(1, { render: "none" });
        insp.input.keyUp(code);
        await insp.time.stepAsync(3, { render: "none" });
      }, code);
    const probeFlag = (flag: keyof Probe, expected: boolean) =>
      page.waitForFunction(
        ([flag, expected]) =>
          (
            window.__yage__!.inspector.getComponentData(
              "localization-probe",
              "LocalizationProbe",
            ) as Record<string, unknown>
          )[flag] === expected,
        [flag, expected] as const,
      );
    const gameplayCounters = (probe: Probe) => ({
      dialogueLines: probe.dialogueLines,
      dialogueCommands: probe.dialogueCommands,
      dialogueCompletions: probe.dialogueCompletions,
      dialogueChoices: probe.dialogueChoices,
      inventoryActions: probe.inventoryActions,
    });

    await page.evaluate(() =>
      window.__yage__!.inspector.time.stepAsync(5, { render: "none" }),
    );
    const initial = await state();
    expect(initial.probe.locale).toBe("en");
    expect(initial.probe.dialogueActive).toBe(true);
    expect(initial.renderer.content).toBe("Renderer: 2 crystals");
    expect(initial.fallback.content).toBe("Missing-key fallback stays visible");

    // L switches language mid-reveal: text swaps, no gameplay counter moves.
    await tap("KeyL");
    const translated = await state();
    expect(translated.probe.locale).toBe("it");
    expect(translated.renderer.content).toBe("Renderer: 2 cristalli");
    expect(translated.fallback.content).toBe(
      "Missing-key fallback stays visible",
    );
    expect(gameplayCounters(translated.probe)).toEqual(
      gameplayCounters(initial.probe),
    );

    // Enter completes the reveal, then a second Enter reaches the choice.
    await tap("Enter");
    await page.waitForFunction(
      () =>
        (
          window.__yage__!.inspector.getComponentData(
            "localization-probe",
            "LocalizationProbe",
          ) as { dialogueCompletions: number }
        ).dialogueCompletions === 1,
    );
    await tap("Enter");
    await probeFlag("dialogueChoosing", true);

    // Switching back on the choice menu keeps the menu and its counters.
    const beforeChoiceLocale = await state();
    await tap("KeyL");
    const afterChoiceLocale = await state();
    expect(afterChoiceLocale.probe.locale).toBe("en");
    expect(afterChoiceLocale.probe.dialogueChoosing).toBe(true);
    expect(gameplayCounters(afterChoiceLocale.probe)).toEqual(
      gameplayCounters(beforeChoiceLocale.probe),
    );

    // P freezes the conversation: Enter does nothing until P resumes it.
    await tap("KeyP");
    expect((await state()).probe.paused).toBe(true);
    await tap("Enter");
    expect((await state()).probe.dialogueChoices).toBe(0);
    await tap("KeyP");
    expect((await state()).probe.paused).toBe(false);

    // Enter confirms the highlighted option and ends the script.
    await tap("Enter");
    await probeFlag("dialogueActive", false);
    expect((await state()).probe.dialogueChoices).toBe(1);

    // I opens the backpack, Enter opens the action menu on the potion.
    await tap("KeyI");
    await tap("Enter");
    const menu = await state();
    expect(menu.probe).toMatchObject({
      inventoryOpen: true,
      inventoryMenuOpen: true,
      inventoryQuantity: 2,
      inventoryActions: 0,
    });

    // A language change redraws the open menu in place: panel, menu, slot,
    // and model all stay as they were.
    await tap("KeyL");
    const menuTranslated = await state();
    expect(menuTranslated.probe).toMatchObject({
      locale: "it",
      inventoryOpen: true,
      inventoryMenuOpen: true,
      inventoryQuantity: 2,
      inventorySelection: menu.probe.inventorySelection,
      inventoryActions: 0,
    });

    // Enter runs the highlighted action, then Esc closes the panel (twice
    // if the menu is still open after the action).
    await tap("Enter");
    expect((await state()).probe.inventoryActions).toBe(1);
    if ((await state()).probe.inventoryMenuOpen) await tap("Escape");
    await tap("Escape");
    expect((await state()).probe.inventoryOpen).toBe(false);

    // T replays the ended conversation.
    const beforeReplay = await state();
    await tap("KeyT");
    await probeFlag("dialogueActive", true);
    const replayed = await state();
    expect(replayed.probe.dialogueLines).toBeGreaterThan(
      beforeReplay.probe.dialogueLines,
    );

    const finalState = await state();
    expect(finalState.errors.callbackErrors).toEqual([]);
    expect(errors).toEqual([]);
  });

  test.describe("loot-addon", () => {
    interface ChestState {
      opened: number;
      waitingQuantity: number;
      waiting: { item: string; quantity: number; reason: string }[];
    }
    interface AdventurerState {
      level: number;
      misses: number;
      found: string[];
      backpackItems: { item: string; quantity: number }[];
      bankedQuantity: number;
    }

    async function boot(page: Page): Promise<void> {
      await page.goto("/loot-addon.html?test&seed=42");
      await page.waitForFunction(
        () =>
          window.__yage__?.inspector.time.isFrozen() &&
          window.__yage__.inspector.getSceneStack().at(-1)?.name ===
            "loot-addon",
        undefined,
        { timeout: 10_000 },
      );
      await page.evaluate(() =>
        window.__yage__!.inspector.time.stepAsync(1, { render: "none" }),
      );
    }

    async function tap(page: Page, key: string): Promise<void> {
      await page.evaluate(async (key) => {
        const inspector = window.__yage__!.inspector;
        inspector.input.keyDown(key);
        await inspector.time.stepAsync(1, { render: "none" });
        inspector.input.keyUp(key);
        await inspector.time.stepAsync(1, { render: "none" });
      }, key);
    }

    async function state(page: Page) {
      return page.evaluate(() => {
        const inspector = window.__yage__!.inspector;
        return {
          chest: inspector.getComponentData(
            "ChestEntity",
            "Chest",
          ) as ChestState,
          adventurer: inspector.getComponentData(
            "AdventurerEntity",
            "Adventurer",
          ) as AdventurerState,
          loot: inspector.getComponentData("ChestEntity", "LootComponent") as {
            lastRoll: LootResult<string> | null;
          },
          errors: inspector.getErrors().callbackErrors,
        };
      });
    }

    function owned({
      chest,
      adventurer,
    }: {
      chest: ChestState;
      adventurer: AdventurerState;
    }): number {
      return (
        adventurer.bankedQuantity +
        chest.waitingQuantity +
        adventurer.backpackItems.reduce((sum, item) => sum + item.quantity, 0)
      );
    }

    function candidate(roll: LootResult<string>, pool: string, entry: string) {
      return roll.trace
        .find((step) => step.pool === pool)
        ?.candidates.find((c) => c.entry === entry);
    }

    test("explains seeded rewards and keeps inventory overflow", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await boot(page);
      await tap(page, "Space");
      const first = await state(page);
      const roll = first.loot.lastRoll!;
      expect(first.chest.opened).toBe(1);
      expect(roll.rewards.map((reward) => reward.source.entry)).toEqual(
        expect.arrayContaining(["coins", "herbs", "potion"]),
      );
      const total = roll.rewards.reduce(
        (sum, reward) => sum + reward.quantity,
        0,
      );
      expect(owned(first)).toBe(total);
      expect(first.chest.waitingQuantity).toBeGreaterThan(0);
      expect(first.chest.waiting[0]?.reason).toBe("capacity");
      expect(candidate(roll, "treasure", "ruby")).toMatchObject({
        status: "condition",
        reason: "requires-level-3",
        probability: 0,
      });
      expect(
        roll.trace.some((step) =>
          step.candidates.some((c) => c.status === "already-selected"),
        ),
      ).toBe(true);

      // Opening again while rewards wait neither discards nor rerolls them.
      await tap(page, "Space");
      expect((await state(page)).chest.opened).toBe(1);
      await tap(page, "KeyB");
      const collected = await state(page);
      expect(collected.chest.waitingQuantity).toBe(0);
      expect(collected.adventurer.bankedQuantity).toBeGreaterThan(0);
      expect(owned(collected)).toBe(total);

      await tap(page, "KeyL");
      await tap(page, "Space");
      const high = await state(page);
      expect(high.adventurer.level).toBe(3);
      expect(high.chest.opened).toBe(2);
      expect(candidate(high.loot.lastRoll!, "treasure", "ruby")).toMatchObject({
        status: "eligible",
        weight: 4,
        probability: 4 / 7,
      });
      expect(high.errors).toEqual([]);

      await boot(page);
      await tap(page, "Space");
      const replay = await state(page);
      expect(replay.loot.lastRoll).toEqual(roll);
      expect(replay.errors).toEqual([]);
      expect(errors).toEqual([]);
    });

    test("drops the crown once, with odds that grow on every miss", async ({
      page,
    }) => {
      await boot(page);
      let crownChest = 0;
      for (let chest = 1; chest <= 20 && crownChest === 0; chest++) {
        const before = (await state(page)).adventurer;
        await tap(page, "Space");
        await tap(page, "KeyB");
        const after = await state(page);
        const roll = after.loot.lastRoll!;
        expect(candidate(roll, "relic", "crown")).toMatchObject({
          status: "eligible",
          weight: 1 + before.misses,
        });
        if (roll.rewards.some((reward) => reward.item === "crown")) {
          crownChest = chest;
          expect(after.adventurer).toMatchObject({
            found: ["crown"],
            misses: 0,
          });
        } else {
          expect(after.adventurer.misses).toBe(before.misses + 1);
        }
      }
      expect(crownChest, "the crown drops within 20 chests").toBeGreaterThan(0);
      // Seed 42 misses at least once, so the pity weight is exercised.
      expect(crownChest).toBeGreaterThan(1);

      await tap(page, "Space");
      const next = (await state(page)).loot.lastRoll!;
      expect(candidate(next, "relic", "crown")).toMatchObject({
        status: "condition",
        reason: "already-found",
      });
      expect(next.rewards.some((reward) => reward.item === "crown")).toBe(
        false,
      );
      expect((await state(page)).errors).toEqual([]);
    });

    test("canvas buttons respond to pointer input", async ({ page }) => {
      await boot(page);
      await page.evaluate(async () => {
        const inspector = window.__yage__!.inspector;
        inspector.input.mouseMove(160, 600);
        inspector.input.mouseDown(0);
        await inspector.time.stepAsync(1, { render: "none" });
        inspector.input.mouseUp(0);
        await inspector.time.stepAsync(1, { render: "none" });
      });
      const clicked = await state(page);
      expect(clicked.chest.opened).toBe(1);
      expect(clicked.errors).toEqual([]);
    });
  });

  test("behavior-tree: interrupts owned work and keeps shared definitions independent", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/behavior-tree.html?test");
    await page.waitForFunction(
      () =>
        window.__yage__?.inspector.time.isFrozen() === true &&
        window.__yage__.inspector.getSceneStack().length > 0,
    );
    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const first = inspector
        .snapshot()
        .scenes.flatMap((scene) => scene.entities)
        .find((entity) => entity.key === "guard-a")!.id;
      const second = inspector
        .snapshot()
        .scenes.flatMap((scene) => scene.entities)
        .find((entity) => entity.key === "guard-b")!.id;
      const state = (id: string) =>
        inspector.getComponentData(id, "GuardState") as {
          phase: string;
          health: number;
          attacks: number;
          heavyAttacks: number;
          calls: number;
          interruptions: number;
          lastInterruption: string;
        };
      const brain = (id: string) =>
        inspector.getComponentData(id, "BehaviorTreeAgent") as {
          enabled: boolean;
          status: string;
          execution: {
            activePaths: string[];
            nodes: Array<{
              id: string;
              kind: string;
              durationSeconds: number | null;
              remainingSeconds: number | null;
              selectedChild: string | null;
              remainingWeights: number[] | null;
            }>;
            transitions: Array<{
              path: string;
              reason: string;
              by: string | null;
            }>;
          };
        };
      await inspector.time.stepAsync(90, { render: "none" });
      const before = [state(first), state(second)];
      const decisions = brain(first).execution.nodes;
      await inspector.time.stepAsync(25, { render: "none" });
      const interrupted = {
        first: state(first),
        second: state(second),
        activePaths: brain(first).execution.activePaths,
        trace: brain(first).execution.transitions,
      };
      await inspector.time.stepAsync(65, { render: "none" });
      const both = [state(first), state(second)];
      // Larger rendered frames still drive the guards through fixed simulation steps.
      inspector.time.setDelta(100);
      await inspector.time.stepAsync(240, { render: "none" });
      inspector.time.setDelta(1000 / 60);
      const completed = [state(first), state(second)];
      const heavyCooldown = (id: string) =>
        brain(id).execution.nodes.find((node) => node.id === "heavy-ready")!
          .remainingSeconds ?? 0;
      // Disable right after a heavy attack, so the cooldown has time left.
      for (let frame = 0; frame < 1200 && heavyCooldown(first) === 0; frame++) {
        await inspector.time.stepAsync(1, { render: "none" });
      }
      inspector.input.tap("Space");
      const disabled = brain(first);
      const cooldownAtDisable = heavyCooldown(first);
      await inspector.time.stepAsync(90, { render: "none" });
      const cooldownWhileDisabled = heavyCooldown(first);
      inspector.input.tap("Space");
      await inspector.time.stepAsync(1, { render: "none" });
      const restarted = brain(first);
      // Disabling mid-retreat ends the retreat action, which stops steering.
      inspector.input.tap("Digit1");
      await inspector.time.stepAsync(20, { render: "none" });
      const retreatPhase = state(first).phase;
      const retreatFrom = inspector.getEntityPosition(first);
      await inspector.time.stepAsync(1, { render: "none" });
      const retreatTo = inspector.getEntityPosition(first);
      inspector.input.tap("Space");
      const position = inspector.getEntityPosition(first);
      await inspector.time.stepAsync(90, { render: "none" });
      const stoppedPosition = inspector.getEntityPosition(first);
      return {
        before,
        decisions,
        interrupted,
        both,
        completed,
        disabled,
        cooldownAtDisable,
        cooldownWhileDisabled,
        restarted,
        retreatPhase,
        retreatFrom,
        retreatTo,
        position,
        stoppedPosition,
        callbackErrors: inspector.getErrors().callbackErrors,
      };
    });
    expect(result.before.map((state) => state.phase)).toEqual([
      "attack",
      "approach",
    ]);
    const reaction = result.decisions.find((node) => node.id === "reaction")!;
    expect(reaction.durationSeconds).toBeGreaterThanOrEqual(0.1);
    expect(reaction.durationSeconds).toBeLessThan(0.3);
    expect(result.decisions.find((node) => node.id === "tactic")).toMatchObject(
      {
        kind: "weightedSelector",
        selectedChild: expect.any(String),
        remainingWeights: expect.any(Array),
      },
    );
    expect(result.interrupted.first).toMatchObject({
      phase: "retreat",
      attacks: 0,
      interruptions: 1,
      lastInterruption: "attack: branch-changed",
    });
    expect(result.interrupted.first.calls).toBeGreaterThan(0);
    expect(result.interrupted.second).toMatchObject({
      phase: "approach",
      interruptions: 0,
    });
    // The parallel keeps the retreat and the calls for help running together.
    expect(result.interrupted.activePaths).toContain(
      "guard/low-health/safety/flee/retreat",
    );
    expect(result.interrupted.activePaths).toContainEqual(
      expect.stringMatching(/^guard\/low-health\/safety\/flee\/calling\//),
    );
    expect(result.interrupted.trace).toContainEqual(
      expect.objectContaining({
        path: expect.stringMatching(
          /^guard\/combat\/attack-cycle\/tactic\/.*attack$/,
        ),
        reason: "branch-changed",
        by: "guard/low-health/safety/flee/retreat",
      }),
    );
    expect(result.both[1]).toMatchObject({
      phase: "retreat",
      lastInterruption: "approach: branch-changed",
    });
    for (const state of result.completed) {
      expect(state.health).toBe(100);
      expect(state.attacks).toBeGreaterThan(0);
      expect(state.calls).toBeGreaterThan(0);
    }
    expect(
      result.completed.reduce((sum, state) => sum + state.heavyAttacks, 0),
    ).toBeGreaterThan(0);
    expect(result.disabled).toMatchObject({ enabled: false, status: "idle" });
    // A disabled agent's clock stops, so its cooldown keeps its remaining time.
    expect(result.cooldownAtDisable).toBeGreaterThan(0);
    expect(result.cooldownWhileDisabled).toBe(result.cooldownAtDisable);
    expect(result.restarted).toMatchObject({
      enabled: true,
      status: "running",
    });
    expect(result.retreatPhase).toBe("retreat");
    expect(result.retreatTo).not.toEqual(result.retreatFrom);
    expect(result.stoppedPosition).toEqual(result.position);
    expect(result.callbackErrors).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("procedural-rooms explores a generated dungeon and reports failed searches", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/procedural-rooms.html?test");
    await page.waitForFunction(
      () => {
        const insp = window.__yage__?.inspector;
        return (
          insp?.time.isFrozen() === true &&
          insp.getSceneStack().at(-1)?.name === "procedural-rooms"
        );
      },
      undefined,
      { timeout: 10_000 },
    );

    interface Region {
      id: string;
      templateId: string;
      variantId: string | null;
      metadata: Record<string, unknown>;
      tags: string[];
    }
    interface MapView {
      mode: string;
      seed: number;
      status: string;
      diagnostics: { code: string; message: string }[];
      summary: {
        regions: number;
        keys: string[];
        visited: string[];
        caveSize: { width: number; height: number } | null;
      };
      generation: {
        regions: Region[];
        connections: { fromPort?: string; fromOpening?: unknown }[];
      };
    }
    interface Stop {
      currentRoom: string | null;
      targetRoom: string | null;
      walking: boolean;
      blocked: boolean;
      atTarget: boolean;
      /** Space found a route and the explorer set off. */
      started: boolean;
      keys: string[];
      visited: number;
    }
    // Each page call runs as an Inspector drive with drawing off: the test
    // steps thousands of frames, and drawing each one would cost more than
    // the game does.
    // Taps a key, steps until the map's generation job finishes, and reads
    // the map. The job runs inside a GenerationController, a bounded number
    // of operations per frame.
    const press = async (code: string): Promise<MapView> => {
      const run = await page.evaluate(async (code) => {
        const insp = window.__yage__!.inspector;
        const map = () =>
          insp.getComponentData("MapHost", "MapState") as Omit<
            MapView,
            "generation"
          >;
        const result = await insp.drive(
          async ({ input, until }) => {
            await input.tap(code);
            await until(() => map().status !== "running", { maxFrames: 600 });
            return {
              ...map(),
              generation: (
                insp.getComponentData("MapHost", "GenerationController") as {
                  generation: MapView["generation"];
                }
              ).generation,
            };
          },
          { render: "none" },
        );
        return result.ok ? result.value : result.error;
      }, code);
      if (typeof run === "string") throw new Error(run);
      return run;
    };
    // Walks to each room in turn, in one page call. Tab cycles the target
    // through the map's regions; `null` keeps the current target. Space
    // walks the route there, and the frames step until the walk ends.
    const tour = async (rooms: readonly (string | null)[]): Promise<Stop[]> => {
      const run = await page.evaluate(async (rooms) => {
        const insp = window.__yage__!.inspector;
        const explorer = () =>
          (
            insp.getComponentData("ExplorerEntity", "Explorer") as {
              exploration: Omit<Stop, "started" | "keys" | "visited">;
            }
          ).exploration;
        const map = () =>
          insp.getComponentData("MapHost", "MapState") as Pick<
            MapView,
            "summary"
          >;
        const result = await insp.drive(
          async ({ input, until }) => {
            const stops: Stop[] = [];
            for (const room of rooms) {
              for (
                let i = 0;
                i < 20 && room && explorer().targetRoom !== room;
                i++
              )
                await input.tap("Tab");
              await input.tap("Space");
              const started = explorer().walking;
              await until(() => !explorer().walking, { maxFrames: 3000 });
              const { keys, visited } = map().summary;
              stops.push({
                ...explorer(),
                started,
                keys: [...keys].sort(),
                visited: visited.length,
              });
            }
            return stops;
          },
          { render: "none", maxFrames: 20_000 },
        );
        return result.ok ? result.value : result.error;
      }, rooms);
      if (typeof run === "string") throw new Error(run);
      return run;
    };

    // Seeds come from the scene's random service, which `?test` makes
    // deterministic, so this run always sees the same dungeon.
    const first = await press("Digit1");
    expect(first.mode).toBe("dungeon");
    expect(first.status).toBe("succeeded");
    const rooms = first.generation.regions;
    expect(rooms).toHaveLength(15);
    expect(first.generation.connections).toHaveLength(14);
    // The catalog rules: exactly one healing shop, two to five mossy halls.
    const healing = rooms.filter((room) => room.tags.includes("healing"));
    expect(healing).toHaveLength(1);
    expect(healing[0]).toMatchObject({
      templateId: "shop",
      variantId: "healing",
      metadata: { stock: "potions", merchant: "traveller" },
    });
    const moss = rooms.filter((room) => room.tags.includes("moss"));
    expect(moss.length).toBeGreaterThanOrEqual(2);
    expect(moss.length).toBeLessThanOrEqual(5);

    const [lockedBoss, treasureA, treasureB, boss, ...visits] = await tour([
      "boss",
      "treasure-a",
      "treasure-b",
      "boss",
      ...rooms.map((room) => room.id),
    ]);
    // The boss room needs both keys. Each treasure room grants one.
    expect(lockedBoss).toMatchObject({ blocked: true, started: false });
    expect(treasureA).toMatchObject({ currentRoom: "treasure-a" });
    expect(treasureA?.keys).toContain("key-a");
    expect(treasureB).toMatchObject({
      currentRoom: "treasure-b",
      keys: ["key-a", "key-b"],
    });
    expect(boss).toMatchObject({ currentRoom: "boss", blocked: false });
    // With both keys, every room is reachable.
    expect(visits.map((stop) => stop.currentRoom)).toEqual(
      rooms.map((room) => room.id),
    );
    expect(visits.at(-1)?.visited).toBe(15);

    // R moves to the next seed and starts a new run.
    const layouts = new Set([JSON.stringify(rooms)]);
    let seed = first.seed;
    for (let i = 0; i < 3; i++) {
      const next = await press("KeyR");
      expect(next.status).toBe("succeeded");
      expect(next.seed).toBe(seed + 1);
      expect(next.summary.keys).toEqual([]);
      seed = next.seed;
      layouts.add(JSON.stringify(next.generation.regions));
    }
    // Every seed gives a different layout.
    expect(layouts.size).toBe(4);

    // A budget too small for fifteen rooms stops without an answer, and
    // bounds that hold only the entrance room exhaust the search.
    const budget = await press("KeyB");
    expect(budget.status).toBe("budget-exceeded");
    expect(budget.diagnostics.at(-1)?.code).toBe("budget");
    const impossible = await press("KeyU");
    expect(impossible.status).toBe("exhausted");
    expect(
      impossible.diagnostics.find((d) => d.code === "bounds")?.message,
    ).toContain("does not fit the bounds");
    expect(await press("KeyR")).toMatchObject({
      mode: "dungeon",
      status: "succeeded",
    });

    // The catalog map selects templates and connection slots without placing
    // anything.
    const catalog = await press("Digit2");
    expect(catalog.status).toBe("succeeded");
    expect(catalog.generation.regions).toHaveLength(15);
    expect(
      catalog.generation.connections.every(
        (link) => link.fromPort !== undefined && link.fromOpening === undefined,
      ),
    ).toBe(true);

    // The cave is one connected floor area, so the walk to its marked tile
    // arrives.
    const cave = await press("Digit3");
    expect(cave.status).toBe("succeeded");
    expect(cave.summary.caveSize).toEqual({ width: 72, height: 42 });
    expect(await tour([null])).toMatchObject([
      { started: true, walking: false, blocked: false, atTarget: true },
    ]);

    const callbackErrors = await page.evaluate(
      () => window.__yage__!.inspector.getErrors().callbackErrors,
    );
    expect(callbackErrors).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// The index page (examples/index.html): a sidebar of every example and a
// stage that runs the selected one in a frame.
test.describe("Examples index", () => {
  test("lists every page and runs the selected one in a frame", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    const links = page.locator(".nav-link");
    await expect(links).toHaveCount(slugs.length);
    const hrefs = await links.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href")),
    );
    expect([...hrefs].sort()).toEqual(slugs.map((slug) => `#${slug}`).sort());

    await page.locator('.nav-link[href="#physics-joints"]').click();
    await expect(page).toHaveURL(/#physics-joints$/);
    await expect(page.locator(".frame-slot iframe")).toHaveAttribute(
      "src",
      "/physics-joints.html",
    );
    // Inside the frame the page drops the title and back link the index shows.
    const frame = page.frameLocator(".frame-slot iframe");
    await expect(frame.locator("#game-container")).toBeVisible();
    await expect(frame.locator(".back-link")).toBeHidden();

    // Next selects the following entry in the list; Back returns to the first.
    const nextHref = hrefs[hrefs.indexOf("#physics-joints") + 1] ?? "";
    expect(nextHref).not.toBe("");
    await page.locator("#next").click();
    await expect(page).toHaveURL(new RegExp(`${nextHref}$`));
    await expect(page.locator(".nav-link[aria-current=page]")).toHaveAttribute(
      "href",
      nextHref,
    );
    await page.goBack();
    await expect(page).toHaveURL(/#physics-joints$/);
    await expect(page.locator(".frame-slot iframe")).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test("search and package filters narrow the list", async ({ page }) => {
    await page.goto("/");
    const visibleLinks = page.locator(".nav-link:visible");
    await expect(visibleLinks).toHaveCount(slugs.length);

    await page.locator("#search").fill("joint");
    await expect(visibleLinks).toHaveCount(1);
    await page.locator("#search").fill("");
    await expect(visibleLinks).toHaveCount(slugs.length);

    // The addons chip keeps only rows that carry an addon badge.
    await page.locator("#filters summary").click();
    await page.locator(".chip", { hasText: /^addons$/ }).click();
    const rows = page.locator(".overview-row:visible");
    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(slugs.length);
    await expect(
      rows.filter({ hasNot: page.locator(".badge.addon") }),
    ).toHaveCount(0);

    // Enter runs the first match.
    await page.locator("#search").fill("dialogue");
    await page.locator("#search").press("Enter");
    await expect(page).toHaveURL(/#dialogue-addon$/);

    await page.locator("#clear-filters").click();
    await expect(visibleLinks).toHaveCount(slugs.length);
  });

  test("a standalone page links back to its entry in the index", async ({
    page,
  }) => {
    await page.goto("/physics-joints.html");
    const back = page.locator(".back-link");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/#physics-joints");
  });

  test("the phone-width drawer takes focus and gives it back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const sidebar = page.locator("#sidebar");
    const menu = page.locator(".overview [data-action=menu]");
    // Closed, the drawer is out of the tab order as well as off screen.
    await expect(sidebar).toBeHidden();

    await menu.click();
    await expect(sidebar).toBeVisible();
    await expect(page.locator("#search")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("a framed page keeps the game in view on a small screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto("/#synth");
    const frame = page.frameLocator(".frame-slot iframe");
    await expect(frame.locator("#pads")).toBeVisible();
    // The pads and controls scroll inside the space the game leaves; the game
    // keeps 40% of the page's content height and nothing ends below the frame.
    const layout = await frame.locator("body").evaluate((body) => {
      const style = getComputedStyle(body);
      const content =
        body.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const game = body.querySelector("#game-container");
      const last = body.lastElementChild?.previousElementSibling;
      return {
        game: (game?.getBoundingClientRect().height ?? 0) / content,
        bottom: last?.getBoundingClientRect().bottom ?? Infinity,
        height: body.clientHeight,
      };
    });
    expect(layout.game).toBeGreaterThanOrEqual(0.399);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height);
  });
});

test("perception explains each failed check, remembers the last position, and drives a separate guard reaction", async ({
  page,
}) => {
  await page.goto("/perception.html?test");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector?.getSceneStack().at(-1)?.name === "perception",
  );
  const result = await page.evaluate(async () => {
    const inspector = window.__yage__!.inspector;
    const sensor = () =>
      inspector.getComponentData("GuardEntity", "PerceptionSensor");
    const brain = () => inspector.getComponentData("GuardEntity", "GuardBrain");
    // One drive with drawing off: the assertions read component state, and
    // the test steps about 700 frames.
    const run = await inspector.drive(
      async ({ step, input }) => {
        const moveTo = async (key: string, frames = 3) => {
          await input.tap(key);
          await step(frames);
        };
        await step(3);
        const initial = sensor();
        await moveTo("Digit2");
        const cover = sensor();
        await step(190);
        const expired = sensor();
        await moveTo("Digit1");
        const reacquired = sensor();
        await moveTo("Digit3");
        const range = sensor();
        await moveTo("Digit4");
        const fov = sensor();
        await moveTo("Digit5");
        const shadow = sensor();
        // Stay in sight until the guard is fully aware, then break line of sight.
        await moveTo("Digit1", 90);
        const alerted = brain();
        await moveTo("Digit2");
        const investigating = brain();
        await step(400);
        return {
          initial,
          cover,
          expired,
          reacquired,
          range,
          fov,
          shadow,
          alerted,
          investigating,
          returned: brain(),
          forgotten: sensor(),
          errors: inspector.getErrors(),
        };
      },
      { render: "none" },
    );
    return run.ok ? run.value : run.error;
  });
  if (typeof result === "string") throw new Error(result);
  const near = (x: number, y: number) => ({
    x: expect.closeTo(x, 0),
    y: expect.closeTo(y, 0),
  });
  // Candidates are evaluated in spawn order: the ally, then the player.
  expect(result.initial).toMatchObject({
    evaluations: [{ reason: "ally" }, { reason: null }],
    diagnostics: [{ visible: true, lastPosition: near(300, 310) }],
  });
  expect(result.cover).toMatchObject({
    evaluations: [{ reason: "ally" }, { reason: "occluded" }],
    diagnostics: [{ visible: false, lastPosition: near(300, 310) }],
  });
  expect(result.expired).toMatchObject({ diagnostics: [] });
  expect(result.reacquired).toMatchObject({ diagnostics: [{ visible: true }] });
  expect(result.range).toMatchObject({
    evaluations: [{}, { reason: "out-of-range" }],
  });
  expect(result.fov).toMatchObject({
    evaluations: [{}, { reason: "outside-field-of-view" }],
  });
  expect(result.shadow).toMatchObject({
    evaluations: [{}, { reason: "below-visibility-threshold" }],
  });
  expect(result.alerted).toMatchObject({ state: "alerted" });
  expect(result.investigating).toMatchObject({
    state: "investigating",
    investigations: 1,
  });
  expect(result.returned).toMatchObject({
    state: "watching",
    investigations: 1,
  });
  expect(result.forgotten).toMatchObject({ diagnostics: [] });
  expect(result.errors.callbackErrors).toEqual([]);
});
