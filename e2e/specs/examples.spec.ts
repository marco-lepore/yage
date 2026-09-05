import { expect, test, type Page } from "@playwright/test";
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
import { stepFrames, waitForClock, waitForTopScene } from "./helpers.js";

async function seedExample(page: Page): Promise<void> {
  // Some examples use Math.random directly rather than the engine RNG.
  await page.addInitScript(() => {
    let s = 1 >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
}

async function openExample(
  page: Page,
  slug: string,
  scene = slug,
): Promise<void> {
  await seedExample(page);
  await page.goto(`/${slug}.html?test`);
  await waitForClock(page);
  await waitForTopScene(page, scene);
  await stepFrames(page, 1);
}

async function tapKey(page: Page, key: string): Promise<void> {
  await page.evaluate(async (code) => {
    const inspector = window.__yage__!.inspector;
    inspector.input.keyDown(code);
    await inspector.time.stepAsync(1);
    inspector.input.keyUp(code);
    await inspector.time.stepAsync(1);
  }, key);
}

async function moveQuestPlayer(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const inspector = window.__yage__!.inspector;
      // At 20 Hz each movement step is 8.75 px, below the herbs' 20 px reach.
      // Focus crossings and interactions use the restored 60 Hz delta.
      const travelFps = 20;
      for (const [axis, target, negative, positive] of [
        ["x", x, "KeyA", "KeyD"],
        ["y", y, "KeyW", "KeyS"],
      ] as const) {
        const distance = target - inspector.getEntityPosition("player")![axis];
        const key = distance < 0 ? negative : positive;
        const frames = Math.floor((Math.abs(distance) * travelFps) / 175);
        inspector.input.keyDown(key);
        inspector.time.setDelta(1000 / travelFps);
        inspector.time.step(frames);
        const remaining = Math.abs(
          target - inspector.getEntityPosition("player")![axis],
        );
        if (remaining > 0.000001) {
          inspector.time.setDelta((remaining * 1000) / 175);
          inspector.time.step(1);
        }
        inspector.input.keyUp(key);
        inspector.time.setDelta(1000 / 60);
        inspector.time.step(1);
      }
    },
    { x, y },
  );
  const position = await page.evaluate(() =>
    window.__yage__!.inspector.getEntityPosition("player"),
  );
  expect(position!.x).toBeCloseTo(x, 5);
  expect(position!.y).toBeCloseTo(y, 5);
}

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

      await seedExample(page);

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

  test("gamepad aims at the pointer unless the right stick is active", async ({
    page,
  }) => {
    await openExample(page, "gamepad");
    const angles = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const rotation = () =>
        inspector
          .snapshotScene("gamepad")
          .entities.find((entity) => entity.name === "ship")!.transform!
          .rotation;
      inspector.input.mouseMove(400, 500);
      inspector.time.step(10);
      const mouse = rotation();
      inspector.input.gamepadAxis("rightX", 1);
      inspector.time.step(10);
      const stick = rotation();
      inspector.input.gamepadAxis("rightX", 0);
      inspector.time.step(10);
      const fallback = rotation();
      inspector.input.mouseMove(400, 300);
      inspector.time.step(10);
      return { mouse, stick, fallback, coincident: rotation() };
    });
    expect(angles.mouse).toBeCloseTo(Math.PI / 2);
    expect(angles.stick).toBeCloseTo(0);
    expect(angles.fallback).toBeCloseTo(Math.PI / 2);
    expect(angles.coincident).toBeCloseTo(angles.fallback);
  });

  test("multitouch draws a released contact for exactly one final frame", async ({
    page,
  }) => {
    await openExample(page, "multitouch");
    const frames = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const bounds = () =>
        inspector
          .snapshotScene("multitouch")
          .entities.find((entity) => entity.name === "visualizer")!
          .components.find(
            (component) => component.type === "GraphicsComponent",
          )!.facets!.render!.bounds;
      inspector.input.pointerMove(200, 300, {
        id: 21,
        type: "touch",
        isPrimary: true,
      });
      inspector.input.pointerDown(0, {
        id: 21,
        type: "touch",
        isPrimary: true,
      });
      inspector.input.pointerMove(500, 300, {
        id: 22,
        type: "touch",
        isPrimary: false,
      });
      inspector.input.pointerDown(0, {
        id: 22,
        type: "touch",
        isPrimary: false,
      });
      inspector.time.step(40);
      const held = bounds();
      inspector.input.pointerUp(0, { id: 21 });
      inspector.time.step(1);
      const released = bounds();
      inspector.time.step(1);
      const remaining = bounds();
      inspector.input.pointerUp(0, { id: 22 });
      inspector.time.step(1);
      const lastRelease = bounds();
      inspector.time.step(1);
      return { held, released, remaining, lastRelease, cleared: bounds() };
    });
    expect(frames.held).not.toBeNull();
    expect(frames.held!.x).toBeLessThan(200);
    expect(frames.released).toEqual(frames.held);
    expect(frames.remaining!.x).toBeGreaterThan(450);
    expect(frames.lastRelease).toEqual(frames.remaining);
    expect(frames.cleared).toBeNull();
  });

  for (const slug of ["pathfinding", "tilemap"] as const) {
    test(`${slug} camera follows the current frame and respects map bounds`, async ({
      page,
    }) => {
      await openExample(page, slug);
      const result = await page.evaluate((example) => {
        const inspector = window.__yage__!.inspector;
        const name = example === "pathfinding" ? "AgentEntity" : "PlayerEntity";
        const start = inspector.getEntityPosition(name)!;
        if (example === "pathfinding") {
          const camera = inspector.snapshot().camera!;
          inspector.input.mouseMove(
            (280 - camera.position.x) * camera.zoom + 400,
            (300 - camera.position.y) * camera.zoom + 300,
          );
          inspector.input.mouseDown(0);
        } else inspector.input.keyDown("KeyD");
        const samples = [];
        for (let frame = 0; frame < 120; frame++) {
          inspector.time.step(1);
          if (frame === 0 && example === "pathfinding")
            inspector.input.mouseUp(0);
          samples.push({
            target: inspector.getEntityPosition(name)!,
            camera: inspector.snapshot().camera!,
          });
        }
        inspector.input.keyUp("KeyD");
        if (example === "tilemap") {
          inspector.input.keyDown("KeyA");
          for (let frame = 0; frame < 160; frame++) {
            inspector.time.step(1);
            samples.push({
              target: inspector.getEntityPosition(name)!,
              camera: inspector.snapshot().camera!,
            });
          }
          inspector.input.keyUp("KeyA");
        }
        return { start, samples };
      }, slug);
      expect(
        result.samples.some(
          ({ target }) =>
            Math.hypot(target.x - result.start.x, target.y - result.start.y) >
            40,
        ),
      ).toBe(true);
      for (const { target, camera } of result.samples) {
        const halfWidth = 400 / camera.zoom;
        const halfHeight = 300 / camera.zoom;
        expect(camera.position.x).toBeCloseTo(
          Math.max(halfWidth, Math.min(1600 - halfWidth, target.x)),
          5,
        );
        expect(camera.position.y).toBeCloseTo(
          Math.max(halfHeight, Math.min(1600 - halfHeight, target.y)),
          5,
        );
      }
      if (slug === "tilemap")
        expect(result.samples.at(-1)!.camera.position.x).toBeCloseTo(
          400 / 1.75,
        );
    });
  }

  test("scene transition status updates when the transition ends", async ({
    page,
  }) => {
    await openExample(page, "scene-transitions", "menu");
    for (const [button, stack] of [
      ["btn-push-fade", "menu → level"],
      ["btn-pop", "menu"],
      ["btn-replace", "level"],
    ]) {
      await page.evaluate(() => window.__yage__!.inspector.events.clearLog());
      await page.locator(`#${button}`).click();
      await expect(page.locator("#status")).toContainText("Transitioning: yes");
      const ended = await page.evaluate(async () => {
        const inspector = window.__yage__!.inspector;
        inspector.time.step(120);
        await Promise.resolve();
        return {
          event: inspector.events
            .getLog()
            .find((event) => event.type === "scene:transition:ended"),
          status: document.getElementById("status")!.textContent,
        };
      });
      expect(ended.event).toBeDefined();
      expect(ended.status).toBe(`Stack:         ${stack}\nTransitioning: no`);
    }
  });

  test("effects sidebar supports native wheel, pan, collapse, and action buttons", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openExample(page, "effects-showcase");
    const sidebar = () =>
      page.evaluate(() => {
        const root =
          window.__yage__!.inspector.snapshotScene("effects-showcase").ui!.root;
        const viewport = root.children[0]!;
        const content = viewport.children[0]!;
        return { root, viewport, content };
      });
    const canvas = (await page.locator("canvas").first().boundingBox())!;
    const point = (x: number, y: number) => ({
      x: canvas.x + (x * canvas.width) / 900,
      y: canvas.y + (y * canvas.height) / 640,
    });
    const wheel = async (deltaY: number) => {
      await Promise.all([
        page
          .locator("canvas")
          .first()
          .evaluate(
            (canvas) =>
              new Promise<void>((resolve) =>
                canvas.addEventListener("wheel", () => resolve(), {
                  once: true,
                }),
              ),
          ),
        page.mouse.wheel(0, deltaY),
      ]);
      await stepFrames(page, 2);
    };
    const clickNode = async (section: number, child?: number, offset = 0) => {
      const { root, viewport, content } = await sidebar();
      const parent = content.children[section]!;
      const node = child === undefined ? parent : parent.children[child]!;
      const virtualY =
        8 +
        viewport.layout.y +
        content.layout.y +
        parent.layout.y +
        (child === undefined ? 0 : node.layout.y) +
        node.layout.height / 2 -
        offset;
      expect(virtualY).toBeGreaterThan(18);
      expect(virtualY).toBeLessThan(622);
      const target = point(900 - 8 - root.layout.width / 2, virtualY);
      await page.mouse.click(target.x, target.y);
      await stepFrames(page, 2);
    };
    const initial = await sidebar();
    expect(initial.viewport.type).toBe("UIScrollView");
    expect(initial.root.layout.height).toBe(624);
    for (const header of [11, 9, 7, 5, 3]) {
      await clickNode(header);
      expect(
        (await sidebar()).content.children[header + 1]!.layout.height,
      ).toBeGreaterThan(0);
    }
    const expanded = await sidebar();
    const maxScroll =
      expanded.content.layout.height - expanded.viewport.layout.height;
    expect(maxScroll).toBeGreaterThan(100);
    const middle = point(780, 320);
    await page.mouse.move(middle.x, middle.y);
    await wheel(10000);
    await clickNode(10, 0, maxScroll);
    const toast = () =>
      page.evaluate(
        () =>
          window.__yage__!.inspector.getComponentData(
            "toast",
            "TextComponent",
          ) as { content: string; visible: boolean },
      );
    expect(await toast()).toMatchObject({
      content: "Toggle bloom on first",
      visible: true,
    });

    // A downward drag reveals earlier controls without activating a button.
    const dragStart = point(870, 80);
    const dragEnd = point(870, 610);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 12 });
    await page.mouse.up();
    await stepFrames(page, 2);
    const offsetAfterPan = Math.max(0, maxScroll - 530);
    await clickNode(3, undefined, offsetAfterPan);
    expect((await sidebar()).content.children[4]!.layout.height).toBe(0);
    await page.mouse.move(middle.x, middle.y);
    await wheel(-10000);
    await clickNode(1);
    expect((await sidebar()).content.children[2]!.layout.height).toBe(0);
    await clickNode(1);
    expect(
      (await sidebar()).content.children[2]!.layout.height,
    ).toBeGreaterThan(0);
  });

  test("quests preserves focus ranges, dialogue blocking, and the herb-to-wolf chain", async ({
    page,
  }) => {
    await openExample(page, "quests-addon");
    const prompt = () =>
      page.evaluate(
        () =>
          window.__yage__!.inspector.getComponentData(
            "interaction-prompt",
            "TextComponent",
          ) as { content: string; visible: boolean },
      );
    const hud = () =>
      page.evaluate(
        () =>
          (
            window.__yage__!.inspector.getComponentData(
              "quest-hud-text",
              "TextComponent",
            ) as { content: string }
          ).content,
      );
    const count = (name: string) =>
      page.evaluate(
        (name) =>
          window
            .__yage__!.inspector.getEntities()
            .filter((entity) => entity.name === name).length,
        name,
      );
    const walkOneFrame = (key: string) =>
      page.evaluate((key) => {
        const inspector = window.__yage__!.inspector;
        inspector.input.keyDown(key);
        inspector.time.step(1);
        inspector.input.keyUp(key);
        return inspector.getComponentData(
          "interaction-prompt",
          "TextComponent",
        ) as {
          content: string;
          visible: boolean;
        };
      }, key);

    await moveQuestPlayer(page, 620, 429);
    expect((await prompt()).visible).toBe(false);
    expect(await walkOneFrame("KeyS")).toMatchObject({
      content: "E defeat",
      visible: true,
    });
    expect(
      await page.evaluate(() =>
        window.__yage__!.inspector.getEntityPosition("interaction-prompt"),
      ),
    ).toEqual({ x: 620, y: 440 });
    for (const [x, y] of [
      [260, 200],
      [340, 420],
      [460, 160],
      [560, 340],
      [420, 480],
    ]) {
      await moveQuestPlayer(page, x!, y!);
    }
    expect(await count("herb")).toBe(0);
    expect(await hud()).toBe("(no active quests)");
    await moveQuestPlayer(page, 665, 300);
    expect((await prompt()).visible).toBe(false);
    expect(await walkOneFrame("KeyD")).toMatchObject({
      content: "E talk",
      visible: true,
    });
    expect(
      await page.evaluate(() =>
        window.__yage__!.inspector.getEntityPosition("interaction-prompt"),
      ),
    ).toEqual({ x: 700, y: 274 });
    await tapKey(page, "KeyE");
    expect((await prompt()).visible).toBe(false);
    const busyMovement = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const before = inspector.getEntityPosition("player");
      inspector.input.keyDown("KeyA");
      inspector.time.step(10);
      inspector.input.keyUp("KeyA");
      inspector.time.step(1);
      return { before, after: inspector.getEntityPosition("player") };
    });
    expect(busyMovement.after).toEqual(busyMovement.before);
    expect(await hud()).toBe("(no active quests)");
    await tapKey(page, "KeyE");
    await tapKey(page, "KeyE");
    expect(await hud()).toContain("Collect red herbs: 5/5");
    expect(await hud()).toContain("Return to the healer: 0/1");
    await tapKey(page, "KeyE");
    await tapKey(page, "KeyE");
    await tapKey(page, "KeyE");
    expect(await hud()).toContain("Thin the Pack");
    expect(await hud()).toContain("Defeat wolves: 0/3");
    let remaining = 3;
    for (const [x, y] of [
      [620, 431],
      [680, 491],
      [560, 471],
    ]) {
      await moveQuestPlayer(page, x!, y!);
      expect(await prompt()).toMatchObject({
        content: "E defeat",
        visible: true,
      });
      await tapKey(page, "KeyE");
      expect(await count("wolf")).toBe(--remaining);
      expect(await hud()).toContain(
        remaining > 0
          ? `Defeat wolves: ${3 - remaining}/3`
          : "Quest complete: Thin the Pack",
      );
    }
    expect((await prompt()).visible).toBe(false);
  });

  test("abilities charge particles restart and kick playback starts at the authored frame", async ({
    page,
  }) => {
    await openExample(page, "abilities-addon", "abilities-addon-demo");
    await tapKey(page, "KeyE");
    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const emitter = () =>
        inspector.getComponentData(
          "PlayerEntity",
          "ParticleEmitterComponent",
        ) as { activeCount: number } | undefined;
      const animation = () =>
        inspector.getComponentData("PlayerEntity", "AnimationController") as {
          current: string;
          frame: number;
          locked: boolean;
        };
      inspector.input.keyDown("Space");
      await inspector.time.stepAsync(35);
      const first = emitter();
      const hold = animation();
      inspector.input.keyUp("Space");
      await inspector.time.stepAsync(1);
      const released = inspector.hasComponent(
        "PlayerEntity",
        "ParticleEmitterComponent",
      );
      for (
        let i = 0;
        i < 90 && !animation().current.startsWith("chargeRelease");
        i++
      )
        await inspector.time.stepAsync(1);
      const kick = animation();
      await inspector.time.stepAsync(180);
      const finished = animation();
      inspector.input.keyDown("Space");
      await inspector.time.stepAsync(35);
      const restarted = emitter();
      inspector.input.keyUp("Space");
      await inspector.time.stepAsync(1);
      return {
        first,
        hold,
        released,
        kick,
        finished,
        restarted,
        ended: inspector.hasComponent(
          "PlayerEntity",
          "ParticleEmitterComponent",
        ),
      };
    });
    expect(result.first?.activeCount).toBe(10);
    expect(result.hold.current).toMatch(/^chargeHold_dir/);
    expect(result.released).toBe(false);
    expect(result.kick.current).toMatch(/^chargeRelease_dir/);
    expect(result.kick.frame).toBeGreaterThanOrEqual(6);
    expect(result.kick.frame).toBeLessThanOrEqual(7);
    expect(result.kick.locked).toBe(true);
    expect(result.finished.locked).toBe(false);
    expect(result.restarted?.activeCount).toBe(10);
    expect(result.ended).toBe(false);
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
