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
      page.evaluate((code) => {
        const insp = window.__yage__!.inspector;
        insp.input.tap(code, 1);
        insp.time.step(3);
      }, code);
    const until = (check: string) =>
      page.waitForFunction((check) => {
        const p = window.__yage__!.inspector.getComponentData(
          "tavern-probe",
          "TavernProbe",
        ) as Record<string, unknown>;
        return new Function("p", `return ${check}`)(p) === true;
      }, check);

    await page.evaluate(() => window.__yage__!.inspector.time.step(5));
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

    // Past the ale and its one-second `<<wait>>`, back to the menu.
    await tap("Enter");
    await tap("Enter");
    await page.evaluate(() => window.__yage__!.inspector.time.step(90));
    await until('p.lastLine === "Barkeep: Cosa ti porto?"');
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
      page.evaluate((code) => {
        const insp = window.__yage__!.inspector;
        insp.input.tap(code, 1);
        insp.time.step(3);
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

    await page.evaluate(() => window.__yage__!.inspector.time.step(5));
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
});
