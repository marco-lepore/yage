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
    /**
     * Held by a test that needs a scene mount still in flight. A browser
     * `scenes.replace` awaits the scenario's preload, so the window between
     * asking for a rebuild and the scene landing is real there.
     */
    mountGate: undefined as Promise<void> | undefined,
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
    const land = (): void => {
      active = scene;
      state.mounted.push(scene.name);
      // The engine runs `onEnter` as it stacks the scene, which is what makes
      // a scenario's `setup` run.
      (scene as { onEnter?: () => void }).onEnter?.();
    };
    const gate = state.mountGate;
    if (!gate) {
      land();
      return Promise.resolve();
    }
    return gate.then(land);
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
      getInputState: () => ({
        keys: [],
        actions: [],
        mouse: { x: 0, y: 0, buttons: [], down: false },
        pointers: [],
        gamepad: { buttons: [], axes: [] },
      }),
      getSceneStack: () => [],
      capture: {
        dataURL: () => Promise.resolve("data:image/png;base64,mock"),
      },
    },
    // No plugin ever registers anything, so a camera-view capture's
    // `RendererKey` lookup always misses — the stub has no renderer to give it.
    context: {
      tryResolve: () => undefined,
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
  modules: Record<string, unknown> = SCENARIOS,
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
  const started = mount({ harness, modules, root: "/src", host });
  return { state, host, started };
}

const errorText = (): string[] =>
  [...document.querySelectorAll(".yage-lab__error")].map(
    (node) => node.textContent ?? "",
  );

const runLine = (): string =>
  document.querySelector(".yage-lab__run")?.textContent ?? "";

/** Whether the panel disables a scenario-list entry, one of the widgets a run or drive must be the only writer of. */
const scenarioItemDisabled = (): boolean | undefined =>
  document.querySelector<HTMLButtonElement>(".yage-lab__item")?.disabled;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    await expect(tuned).rejects.toThrow(/run or drive is in flight/);
    await expect(switched).rejects.toThrow(/run or drive is in flight/);

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

describe("drive", () => {
  it("throws when no scenario is mounted", async () => {
    const { started } = boot("", ["renderer"], undefined, {});
    const api = await started;
    expect(api.current()).toBeUndefined();
    await expect(api.drive(() => undefined)).rejects.toThrow(
      "No scenario is mounted.",
    );
  });

  it("runs against the scene as it stands, without rebuilding", async () => {
    const { state, started } = boot("?scenario=drop");
    const api = await started;
    const mountsBefore = state.mounted.length;

    let seenFirst = -1;
    await api.drive((ctx) => {
      const scene = ctx.scene as Scene & { hits?: number };
      scene.hits = (scene.hits ?? 0) + 1;
      seenFirst = scene.hits;
    });
    let seenSecond = -1;
    await api.drive((ctx) => {
      seenSecond = (ctx.scene as Scene & { hits?: number }).hits ?? 0;
    });

    expect(seenFirst).toBe(1);
    // Still 1 on the second call: nothing rebuilt the scene in between.
    expect(seenSecond).toBe(1);
    expect(state.mounted.length).toBe(mountsBefore);
  });

  it("rebuilds first when asked", async () => {
    const { state, started } = boot("?scenario=drop");
    const api = await started;
    const mountsBefore = state.mounted.length;

    let sceneSeen: Scene | undefined;
    await api.drive(
      (ctx) => {
        sceneSeen = ctx.scene;
      },
      { rebuild: true },
    );

    expect(state.mounted.length).toBe(mountsBefore + 1);
    expect(sceneSeen).toBe(api.scene());
  });

  it("does not need the scenario to declare its own drive", async () => {
    const { started } = boot("?scenario=spin");
    const api = await started;
    const result = await api.drive(() => "ok");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("ok");
  });

  it("resolves with the callback's return value, and counts its frames", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    const result = await api.drive(async (ctx) => {
      await ctx.step(3);
      return { hp: 7 };
    });
    expect(result.ok).toBe(true);
    expect(result.framesUsed).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    if (result.ok) expect(result.value).toEqual({ hp: 7 });
  });

  it("collects a capture into the result", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    const result = await api.drive(async (ctx) => {
      await ctx.capture("mid-drive");
    });
    expect(result.captures).toEqual([
      { label: "mid-drive", dataUrl: "data:image/png;base64,mock" },
    ]);
  });

  it("resolves ok:false with the message for a callback throw, rather than rejecting", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    const result = await api.drive(() => {
      throw new Error("boom");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("boom");
  });

  it("surfaces a failed drive in the panel's errors, without touching the run state", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    await api.drive(() => {
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText().join()).toContain("boom");
    expect(runLine()).toBe("");
  });

  it("restores the clock's play state after success and after a callback throw", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    expect(api.clock.isRunning).toBe(true);

    await api.drive(async (ctx) => {
      await ctx.step();
    });
    expect(api.clock.isRunning).toBe(true);

    await api.drive(() => {
      throw new Error("boom");
    });
    expect(api.clock.isRunning).toBe(true);
  });

  it("refuses to swap the scene, start a run, or start a second drive while one is in flight", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;

    // All asked for in the turn the drive starts in: the stub engine settles
    // a drive in a few microtasks, so anything awaited first would let it
    // finish.
    const driving = api.drive(async (ctx) => {
      await ctx.step(DRIVE_FRAMES);
      return "done";
    });
    const second = api.drive(() => undefined);
    const ran = api.run();
    const tuned = api.setControl("count", 5);
    const switched = api.show("spin");

    await expect(second).rejects.toThrow(/run or drive is in flight/);
    await expect(ran).rejects.toThrow(/already in flight/);
    await expect(tuned).rejects.toThrow(/run or drive is in flight/);
    await expect(switched).rejects.toThrow(/run or drive is in flight/);

    const result = await driving;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("done");
  });

  it("disables the panel's widgets during an ad-hoc drive and re-enables them after", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    expect(scenarioItemDisabled()).toBe(false);

    let sawDisabled = false;
    await api.drive(async (ctx) => {
      sawDisabled = scenarioItemDisabled() === true;
      await ctx.step();
    });

    expect(sawDisabled).toBe(true);
    expect(scenarioItemDisabled()).toBe(false);
  });

  it("leaves the clock paused afterwards when it was paused before", async () => {
    const { started } = boot("?scenario=drop&paused=1");
    const api = await started;
    expect(api.clock.isRunning).toBe(false);

    await api.drive(async (ctx) => {
      await ctx.step();
    });
    expect(api.clock.isRunning).toBe(false);
  });

  it("clears a driveError once a later drive succeeds", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    await api.drive(() => {
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText().join()).toContain("boom");

    await api.drive(() => "ok");
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText()).toEqual([]);
  });

  it("clears a driveError once a rebuild runs, however it was asked for", async () => {
    const { started } = boot("?scenario=drop");
    const api = await started;
    await api.drive(() => {
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText().join()).toContain("boom");

    await api.setControl("count", 5);
    await vi.advanceTimersByTimeAsync(200);
    expect(errorText()).toEqual([]);
  });

  it("labels a failing opt-in rebuild as Rebuild, not Drive, and rejects", async () => {
    let shouldFail = false;
    const modules = {
      "/src/glitch.scenario.ts": {
        default: defineScenario({
          setup: () => {
            if (shouldFail) throw new Error("setup boom");
          },
        }),
      },
    };
    const { started } = boot(
      "?scenario=glitch",
      ["renderer"],
      undefined,
      modules,
    );
    const api = await started;

    // The boot mount ran with `shouldFail` still false, so this is the only
    // rebuild that fails.
    shouldFail = true;
    await expect(
      api.drive(() => undefined, { rebuild: true }),
    ).rejects.toThrow("setup boom");

    await vi.advanceTimersByTimeAsync(200);
    const text = errorText().join();
    expect(text).toContain("Rebuild");
    expect(text).toContain("setup boom");
    expect(text).not.toContain("Drive");
  });

  it("refuses to drive when a queued rebuild failed, leaving the scene behind the panel", async () => {
    let shouldFail = false;
    const modules = {
      "/src/glitch.scenario.ts": {
        default: defineScenario({
          controls: { size: control.int(1, { min: 1, max: 9 }) },
          setup: () => {
            if (shouldFail) throw new Error("setup boom");
          },
        }),
      },
    };
    const { started } = boot(
      "?scenario=glitch",
      ["renderer"],
      undefined,
      modules,
    );
    const api = await started;
    const mounted = api.scene();

    // The boot mount ran with `shouldFail` still false, so only the rebuild
    // this control change asks for fails. Fire-and-forget, like the panel's
    // own control widget, so nobody sees the rejection.
    shouldFail = true;
    void api.setControl("size", 4).catch(() => undefined);
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();

    // The scene is still the one built from the old value, so a drive here
    // would report on a state the panel never reached.
    expect(api.scene()).toBe(mounted);
    await expect(api.drive(() => undefined)).rejects.toThrow(
      /was not built from the current scenario and control values/,
    );

    // Asking for the rebuild explicitly is the way through, and it fails
    // loudly rather than silently driving the wrong scene.
    await expect(
      api.drive(() => undefined, { rebuild: true }),
    ).rejects.toThrow("setup boom");
  });

  it("marks the scene with the values it was built from, not ones set during the mount", async () => {
    // Counted rather than flagged: which rebuild fails then does not depend on
    // when the test flips a boolean relative to the queue draining.
    let setups = 0;
    const modules = {
      "/src/glitch.scenario.ts": {
        default: defineScenario({
          controls: { size: control.int(1, { min: 1, max: 9 }) },
          setup: () => {
            setups++;
            // 1 is the boot mount, 2 is the size-2 rebuild, 3 is size-3.
            if (setups === 3) throw new Error("setup boom");
          },
        }),
      },
    };
    const { state, started } = boot(
      "?scenario=glitch",
      ["renderer"],
      undefined,
      modules,
    );
    const api = await started;

    // Hold the mount the way a browser preload does, so a control change can
    // land while the scene this rebuild is placing is still in flight.
    let release!: () => void;
    state.mountGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    void api.setControl("size", 2).catch(() => undefined);
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();

    // Moves `values` on while the size-2 scene is mid-mount, and queues the
    // rebuild that would place a size-3 scene.
    void api.setControl("size", 3).catch(() => undefined);

    release();
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();

    // The size-3 rebuild threw, so what is mounted was built from size 2
    // while the panel reads 3. A drive here would report on neither.
    expect(setups).toBe(3);
    expect(api.controls()["size"]).toBe(3);
    await expect(api.drive(() => undefined)).rejects.toThrow(
      /was not built from the current scenario and control values/,
    );
  });

  it("runs against the scene a rebuild already queued lands on, not the outgoing one", async () => {
    const { state, started } = boot("?scenario=drop");
    const api = await started;
    const outgoing = api.scene();

    // Hold the next mount so the rebuild is still in flight when the drive
    // starts, which is what a browser preload does.
    let release!: () => void;
    state.mountGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Fire-and-forget, like the panel's own scenario click.
    void api.show("spin");
    let sceneSeen: Scene | undefined;
    const driven = api.drive((ctx) => {
      sceneSeen = ctx.scene;
    });

    // Give a drive that did not wait every chance to read the outgoing scene.
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(sceneSeen).toBeUndefined();

    release();
    await driven;

    expect(api.current()?.id).toBe("spin");
    expect(sceneSeen).not.toBe(outgoing);
    expect(sceneSeen).toBe(api.scene());
  });

  it("passes pace and captureView from opts through to the run", async () => {
    const waits = vi.fn((callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", waits);

    // Paused: `LabClock`'s own play loop schedules through the same global,
    // and this stub would recurse into it if the clock were running.
    const { started } = boot("?scenario=drop&paused=1");
    const api = await started;

    const paced = await api.drive(
      async (ctx) => {
        await ctx.step(2);
      },
      { pace: "frame" },
    );
    expect(paced.ok).toBe(true);
    expect(waits).toHaveBeenCalledTimes(2);

    // The stub engine has no RendererPlugin, so a camera-view capture —
    // reachable only if `captureView` made it through to `runDrive` — fails
    // distinctly from the default content view, which the stub supports.
    const captured = await api.drive(
      async (ctx) => {
        await ctx.capture();
      },
      { captureView: "camera" },
    );
    expect(captured.ok).toBe(false);
  });

  it("applies the default frame budget when maxFrames is omitted", async () => {
    const { started } = boot("?scenario=drop&paused=1");
    const api = await started;

    const result = await api.drive(async (ctx) => {
      // A single jump straight to the default, rather than 10,000 real
      // `step(1)` calls.
      await ctx.step(10_000);
      await ctx.step(1);
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.timedOut).toBe(true);
  });

  it("passes an explicit maxFrames through to the run", async () => {
    const { started } = boot("?scenario=drop&paused=1");
    const api = await started;

    const result = await api.drive(
      async (ctx) => {
        for (;;) {
          await ctx.step(1);
        }
      },
      { maxFrames: 3 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.timedOut).toBe(true);
      expect(result.framesUsed).toBe(3);
    }
  });
});

describe("run() and the frame budget", () => {
  it("applies no frame budget to a scenario's own drive", async () => {
    const modules = {
      "/src/marathon.scenario.ts": {
        default: defineScenario({
          title: "Marathon",
          controls: {},
          setup: () => {},
          async drive({ step }) {
            // Well past the ad-hoc default budget — `run()` must not cap it.
            await step(20_000);
          },
        }),
      },
    };
    const { started } = boot(
      "?scenario=marathon",
      ["renderer"],
      undefined,
      modules,
    );
    const api = await started;

    const result = await api.run();

    expect(result.ok).toBe(true);
    expect(result.framesUsed).toBe(20_000);
  });
});
