// @vitest-environment happy-dom
import { AssetHandle, defineEvent, Engine, Scene } from "@yagejs/core";
import type { SceneHooks } from "@yagejs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineHarness } from "../grammar/harness.js";
import { defineScenario } from "../grammar/scenario.js";
import type { AnyScenario } from "../grammar/scenario.js";
import { LAB_GLOBAL, mount } from "./mountLab.js";

const entered = defineEvent<{ run: number }>("lab:entered");
const mounted = defineEvent<{ run: number }>("lab:mounted");
const exited = defineEvent("lab:exited");
const engines: Engine[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/lab?paused=true");
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  (globalThis as Record<string, unknown>)[LAB_GLOBAL] = undefined;
});

async function boot(scenario: AnyScenario) {
  const engine = new Engine();
  engines.push(engine);
  engine.inspector.attachTimeController({
    isFrozen: true,
    freeze() {},
    thaw() {},
    setDelta() {},
    stepFrames(frames, dtMs = 1000 / 60) {
      for (let i = 0; i < frames; i++) engine.loop.tick(dtMs);
    },
  });
  engine.inspector.events.setEnabled(true);
  engine.registerSceneHooks({
    afterExit: () => engine.events.emit("engine:stopped", undefined),
  });
  const register = engine.registerSceneHooks.bind(engine);
  const unregisters: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(engine, "registerSceneHooks").mockImplementation(
    (hooks: SceneHooks) => {
      const unregister = vi.fn(register(hooks));
      unregisters.push(unregister);
      return unregister;
    },
  );
  const api = await mount({
    harness: defineHarness({
      engine: () => engine,
      // The real Inspector has a headless clock; rendering is not needed here.
      plugins: () => [{ name: "debug", version: "test" }],
    }),
    modules: { "/src/events.scenario.ts": { default: scenario } },
    root: "/src",
  });
  return { engine, api, unregisters };
}

describe("Lab rebuild event history", () => {
  it.each([0, 0.5])(
    "preserves new entry events with a %s-second default transition without advancing frames",
    async (duration) => {
      let run = 0;
      const transition = {
        duration,
        begin: vi.fn(),
        tick: vi.fn(),
        end: vi.fn(),
      };
      class TransitionScene extends Scene {
        readonly name = "transition-events";
        override readonly defaultTransition = transition;
        onEnter() {
          this.spawn("previous-run-entity");
          this.emit(entered, { run: ++run });
        }
        onExit() {
          this.emit(exited);
        }
      }
      const { engine, api, unregisters } = await boot(
        defineScenario({
          scene: () => new TransitionScene(),
          onMounted: (scene) => scene.emit(mounted, { run }),
          async drive() {},
        }),
      );
      for (let expectedRun = 1; expectedRun <= 3; expectedRun++) {
        if (expectedRun > 1) {
          expect(await api.run()).toMatchObject({ ok: true });
        }
        expect(run).toBe(expectedRun);
        for (const pattern of ["lab:entered", "lab:mounted"]) {
          await expect(
            engine.inspector.events.waitFor(pattern, { withinFrames: 0 }),
          ).resolves.toMatchObject({ payload: { run: expectedRun } });
        }
        for (const pattern of [
          "lab:exited",
          "entity:destroyed",
          "engine:stopped",
        ]) {
          await expect(
            engine.inspector.events.waitFor(pattern, { withinFrames: 0 }),
          ).rejects.toThrow("0 frames");
        }
        expect(engine.inspector.time.isFrozen()).toBe(true);
        expect(engine.inspector.time.getFrame()).toBe(0);
        expect(engine.scenes.isTransitioning).toBe(false);
        expect(unregisters).toHaveLength(expectedRun - 1);
        for (const unregister of unregisters) {
          expect(unregister).toHaveBeenCalledOnce();
        }
      }
      expect(transition.begin).not.toHaveBeenCalled();
      expect(transition.tick).not.toHaveBeenCalled();
      expect(transition.end).not.toHaveBeenCalled();
    },
  );

  it.each(["setup", "scene"] as const)(
    "keeps only the new %s entry events across consecutive runs",
    async (form) => {
      let run = 0;
      const setup = (scene: Scene) => {
        scene.spawn("previous-run-entity");
        scene.emit(entered, { run: ++run });
      };
      class EventScene extends Scene {
        readonly name = "events";
        onEnter() {
          setup(this);
        }
        onExit() {
          this.emit(exited);
        }
      }
      const scenario = defineScenario({
        ...(form === "setup"
          ? {
              setup(scene: Scene) {
                setup(scene);
                scene.onExit = () => scene.emit(exited);
              },
            }
          : { scene: () => new EventScene() }),
        onMounted: (scene) => scene.emit(mounted, { run }),
        async drive({ events }) {
          for (const pattern of ["lab:entered", "lab:mounted"]) {
            await expect(
              events.waitFor(pattern, { withinFrames: 0 }),
            ).resolves.toMatchObject({ payload: { run } });
          }
          for (const pattern of [
            "lab:exited",
            "entity:destroyed",
            "engine:stopped",
          ]) {
            await expect(
              events.waitFor(pattern, { withinFrames: 0 }),
            ).rejects.toThrow("0 frames");
          }
        },
      });
      const { engine, api, unregisters } = await boot(scenario);
      await expect(
        engine.inspector.events.waitFor("lab:entered", { withinFrames: 0 }),
      ).resolves.toMatchObject({ payload: { run: 1 } });
      expect(
        engine.inspector.events.getLog().map((event) => event.type),
      ).not.toContain("engine:started");
      expect(unregisters).toHaveLength(0);
      for (let expectedRun = 2; expectedRun <= 3; expectedRun++) {
        expect(await api.run()).toMatchObject({ ok: true });
        expect(run).toBe(expectedRun);
        expect(unregisters).toHaveLength(expectedRun - 1);
        expect(unregisters.at(-1)).toHaveBeenCalledOnce();
      }
    },
  );

  it("unregisters the reset hook when replacement preload fails", async () => {
    let builds = 0;
    class PreloadedScene extends Scene {
      readonly name = "preloaded";
      readonly preload =
        ++builds === 1
          ? []
          : [new AssetHandle("missing-loader", "broken.asset")];
      onEnter() {
        this.spawn("old-entity");
        this.emit(entered, { run: builds });
      }
      onExit() {
        this.emit(exited);
      }
    }
    const { engine, api, unregisters } = await boot(
      defineScenario({ scene: () => new PreloadedScene() }),
    );
    const previous = engine.scenes.active;
    await expect(
      api.drive(async () => {}, { rebuild: true }),
    ).rejects.toThrow();
    expect(engine.scenes.active).toBe(previous);
    expect(unregisters).toHaveLength(1);
    expect(unregisters[0]).toHaveBeenCalledOnce();
    await engine.scenes.pop();
    await expect(
      engine.inspector.events.waitFor("lab:entered", { withinFrames: 0 }),
    ).resolves.toMatchObject({ payload: { run: 1 } });
    await expect(
      engine.inspector.events.waitFor("lab:exited", { withinFrames: 0 }),
    ).resolves.toMatchObject({ type: "lab:exited" });
  });
});
