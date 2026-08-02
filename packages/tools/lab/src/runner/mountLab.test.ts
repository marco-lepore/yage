// @vitest-environment happy-dom
import type { CallbackErrorRecord, Engine, Plugin, Scene } from "@yagejs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { control } from "../grammar/controls.js";
import { defineHarness } from "../grammar/harness.js";
import { defineScenario } from "../grammar/scenario.js";
import { LAB_GLOBAL, mount, type LabApi } from "./mountLab.js";

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

/** Frames the driven scenario's `drive` issues. */
const DRIVE_FRAMES = 4;

const SCENARIOS = {
  "/src/drop.scenario.ts": {
    default: defineScenario({
      title: "Physics / Ball drop",
      controls: { count: control.int(3, { min: 1, max: 12 }) },
      setup: () => {},
      async drive({ controls, expect: assert, step }) {
        await step(DRIVE_FRAMES);
        assert(controls.count).toBeGreaterThan(0);
      },
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
function boot(
  search: string,
  plugins: readonly string[] = ["renderer"],
  startError?: Error,
) {
  window.history.replaceState(null, "", `/lab${search}`);
  const { state, engine } = stubEngine();
  if (startError) engine.start = () => Promise.reject(startError);
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

  it("settles `ready` once the first scenario is up", async () => {
    // The API is published before the engine starts, so an out-of-page driver
    // needs something else to wait on before it reaches for a scene.
    const { state, started } = boot("?scenario=drop");
    const api = (globalThis as Record<string, unknown>)[LAB_GLOBAL] as LabApi;
    let settled = false;
    void api.ready.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    await started;
    await api.ready;
    expect(state.mounted).toContain("drop");
  });

  it("rejects `ready` with whatever stopped the engine from starting", async () => {
    // The API reaches the global before the engine starts, so a page whose
    // boot threw still looks alive. `ready` is what carries the reason, and a
    // caller waiting on it would otherwise wait forever.
    const { started } = boot("", ["renderer"], new Error("no WebGL context"));
    const api = (globalThis as Record<string, unknown>)[LAB_GLOBAL] as LabApi;

    await expect(started).rejects.toThrow("no WebGL context");
    await expect(api.ready).rejects.toThrow("no WebGL context");
  });
});

describe("run", () => {
  const runLine = (): string =>
    document.querySelector(".yage-lab__run")?.textContent ?? "";

  it("rebuilds the scene, runs the drive and reports what it took", async () => {
    const { state, started } = boot("?scenario=drop");
    const api = await started;
    const mountsBefore = state.mounted.length;

    const result = await api.run();

    expect(result.ok).toBe(true);
    expect(result.framesUsed).toBe(DRIVE_FRAMES);
    // A previous run leaves the scene wherever it drove it to.
    expect(state.mounted.length).toBe(mountsBefore + 1);
    expect(runLine()).toContain(`pass · ${DRIVE_FRAMES} frames`);
  });

  it("leaves the clock running afterwards when it was running before", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    expect(api.clock.isRunning).toBe(true);
    await api.run();
    expect(api.clock.isRunning).toBe(true);
  });

  it("rejects for a scenario that declares no drive", async () => {
    const { started } = boot("?scenario=spin");
    const api = await started;
    await expect(api.run()).rejects.toThrow(/declares no drive/);
    expect(runLine()).toBe("");
  });

  it("drops a result the controls no longer describe", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    await api.run();
    expect(runLine()).not.toBe("");
    await api.setControl("count", 5);
    expect(runLine()).toBe("");
  });

  it("refuses to swap the scene or the values under a run in flight", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;

    // All asked for in the turn the run starts in: the stub engine settles a
    // run in a few microtasks, so anything awaited first would let it finish.
    const running = api.run();
    const second = api.run();
    const tuned = api.setControl("count", 5);
    const switched = api.show("spin");

    await expect(second).rejects.toThrow(/already in flight/);
    // A control change would rebuild the scene the drive is holding, and a
    // scenario switch would land this run's result under another scenario.
    await expect(tuned).rejects.toThrow(/run is in flight/);
    await expect(switched).rejects.toThrow(/run is in flight/);

    const result = await running;
    expect(result.framesUsed).toBe(DRIVE_FRAMES);
    expect(api.controls()).toEqual({ count: 3 });
    await api.setControl("count", 5);
    expect(api.controls()).toEqual({ count: 5 });
  });

  it("keeps the clock's own frames out of a run", async () => {
    const { state, started } = boot("?scenario=drop");
    const api = await started;
    const before = state.frame;

    const running = api.run();
    api.clock.play();
    await api.clock.step(10);

    const result = await running;
    expect(result.framesUsed).toBe(DRIVE_FRAMES);
    // Counted on the engine rather than on the result: a frame the clock
    // issues before the drive starts is invisible to `framesUsed`, and it
    // still means two writers.
    expect(state.frame - before).toBe(DRIVE_FRAMES);
  });
});
