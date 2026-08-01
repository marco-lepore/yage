// @vitest-environment happy-dom
import type { CallbackErrorRecord, Engine, Plugin, Scene } from "@yagejs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { control } from "../grammar/controls.js";
import { defineHarness } from "../grammar/harness.js";
import { defineScenario } from "../grammar/scenario.js";
import { LAB_GLOBAL, mount } from "./mountLab.js";

/**
 * The engine surface the runner touches. Real enough to boot against, and it
 * records the calls the panel's own behaviour depends on.
 */
function stubEngine() {
  const state = {
    plugins: [] as string[],
    frozen: false,
    delta: 0,
    frame: 0,
    mounted: [] as string[],
    errors: [] as CallbackErrorRecord[],
    loopRunning: false,
  };
  let active: Scene | null = null;

  const time = {
    freeze: () => {
      state.frozen = true;
    },
    isFrozen: () => state.frozen,
    setDelta: (ms: number) => {
      state.delta = ms;
    },
    getFrame: () => state.frame,
    step: (frames: number) => {
      state.frame += frames;
    },
    stepAsync: (frames: number) => {
      state.frame += frames;
      return Promise.resolve();
    },
  };

  const mountScene = (scene: Scene): Promise<void> => {
    active = scene;
    state.mounted.push(scene.name);
    // The engine runs `onEnter` as it stacks the scene, which is what makes a
    // scenario's `setup` run.
    (scene as { onEnter?: () => void }).onEnter?.();
    return Promise.resolve();
  };

  const engine = {
    use(plugin: Plugin) {
      state.plugins.push(plugin.name);
      return this;
    },
    start: () => {
      state.loopRunning = true;
      return Promise.resolve();
    },
    loop: {
      get isRunning() {
        return state.loopRunning;
      },
    },
    scenes: {
      get active() {
        return active;
      },
      push: mountScene,
      replace: mountScene,
    },
    inspector: {
      time,
      getErrors: () => ({ callbackErrors: [...state.errors] }),
    },
  };

  return { state, engine: engine as unknown as Engine };
}

const SCENARIOS = {
  "/src/drop.scenario.ts": {
    default: defineScenario({
      title: "Physics / Ball drop",
      controls: { count: control.int(3, { min: 1, max: 12 }) },
      setup: () => {},
    }),
  },
  "/src/spin.scenario.ts": {
    default: defineScenario({
      title: "Basics / Spin",
      controls: { count: control.int(5, { min: 1, max: 12 }) },
      setup: () => {},
    }),
  },
};

/** `plugins` is what the project's own harness declares. */
function boot(search: string, plugins: readonly string[] = ["renderer"]) {
  window.history.replaceState(null, "", `/lab${search}`);
  const { state, engine } = stubEngine();
  const host = document.createElement("div");
  document.body.append(host);
  const harness = defineHarness({
    engine: () => engine,
    plugins: () => plugins.map((name) => ({ name }) as Plugin),
  });
  const started = mount({ harness, modules: SCENARIOS, root: "/src", host });
  return { state, host, started };
}

const errorText = (): string[] =>
  [...document.querySelectorAll(".yage-lab__error")].map(
    (node) => node.textContent ?? "",
  );

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as Record<string, unknown>)[LAB_GLOBAL] = undefined;
});

describe("mount", () => {
  it("freezes the engine's clock before the first scenario is built", async () => {
    const { state, started } = boot("");
    await started;
    expect(state.frozen).toBe(true);
    expect(state.delta).toBeCloseTo(1000 / 60);
  });

  it("freezes it even when the link says the clock is paused", async () => {
    const { state, started } = boot("?paused=1");
    const api = await started;
    // Without this the engine's own ticker keeps simulating while the panel
    // reports a frame count it alone issues.
    expect(state.frozen).toBe(true);
    expect(api.clock.isRunning).toBe(false);
  });

  it("supplies DebugPlugin when the harness leaves it out", async () => {
    const { state, started } = boot("");
    await started;
    expect(state.plugins).toEqual(["renderer", "debug"]);
  });

  it("adds no second one when the harness declares its own", async () => {
    // `Engine.use` rejects a duplicate name, so appending here would throw.
    const { state, started } = boot("", ["renderer", "debug"]);
    await started;
    expect(state.plugins).toEqual(["renderer", "debug"]);
  });

  it("opens the scenario, controls and speed a link carries", async () => {
    const { started } = boot("?scenario=drop&c.count=9&speed=0.25");
    const api = await started;
    expect(api.current()?.id).toBe("drop");
    expect(api.controls()).toEqual({ count: 9 });
    expect(api.clock.speed).toBe(0.25);
  });

  it("falls back for an unknown id, says so, and keeps its controls off the substitute", async () => {
    const { started } = boot("?scenario=nonesuch&c.count=9");
    const api = await started;
    expect(api.current()?.id).toBe("spin");
    expect(api.controls()).toEqual({ count: 5 });
    expect(errorText().join()).toContain('No scenario with id "nonesuch"');
  });

  it("clears what it reported once a rebuild succeeds, however it was asked for", async () => {
    const { started } = boot("?scenario=nonesuch");
    const api = await started;
    expect(errorText()).not.toEqual([]);
    await api.show("drop");
    // `LabApi` has no panel call of its own; the poll is what redraws.
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText()).toEqual([]);
  });

  it("reports a game loop that stopped, which no rebuild can undo", async () => {
    const { state, started } = boot("");
    const api = await started;
    expect(errorText()).toEqual([]);

    state.loopRunning = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText().join()).toContain("stopped its game loop");

    // A rebuild after one of these looks like it worked, so the panel has to
    // keep saying it.
    await api.show("drop");
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText().join()).toContain("stopped its game loop");
  });

  it("writes the state it settled on back to the query string", async () => {
    const { started } = boot("?scenario=drop&c.count=9&speed=0.25&paused=1");
    await started;
    await vi.advanceTimersByTimeAsync(400);
    expect(window.location.search).toBe(
      "?scenario=drop&c.count=9&speed=0.25&paused=1",
    );
  });

  it("exposes the api before a scenario is mounted", async () => {
    const { started } = boot("");
    expect((globalThis as Record<string, unknown>)[LAB_GLOBAL]).toBeDefined();
    await started;
  });
});
