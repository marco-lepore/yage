import type { Engine, Scene, ServiceKey } from "@yagejs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DriveResult, runDrive } from "./runDrive.js";

/**
 * Why the run failed, or `undefined` when it passed. `DriveResult` carries
 * `error` on its failed arm alone, and a message beats a bare `ok` when one of
 * these assertions is the thing that broke.
 */
const failure = (result: DriveResult): string | undefined =>
  result.ok ? undefined : result.error;

/**
 * The engine surface a run touches, recording what it was asked for in order.
 * `actions` is what an `InputPlugin` would have registered.
 */
function stubEngine(
  opts: {
    actions?: boolean;
    stageBounds?: { width: number; height: number };
    textureLimit?: number;
  } = {},
) {
  const calls: string[] = [];
  const renderer = stubRenderer(opts);
  const stepAsyncCalls: (
    | readonly [frames: number]
    | readonly [frames: number, opts: { dtMs?: number }]
  )[] = [];
  let frame = 0;

  const step = (frames: number): void => {
    for (let i = 0; i < frames; i++) {
      frame++;
      calls.push("step");
    }
  };

  const time = {
    getFrame: () => frame,
    stepAsync: (frames = 1, stepOpts?: { dtMs?: number }) => {
      stepAsyncCalls.push(
        stepOpts === undefined ? [frames] : [frames, stepOpts],
      );
      step(frames);
      return Promise.resolve();
    },
  };

  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(`${name}(${args.map(String).join(",")})`);
    };

  const events = { getLog: () => [] };

  // Tracks what a drive left held, so `getInputState()` can report it —
  // exercised by the `state` tests below.
  const heldKeys = new Set<string>();
  const heldActions = new Set<string>();

  const engine = {
    inspector: {
      time,
      events,
      input: {
        keyDown: (code: string) => {
          heldKeys.add(code);
          record("keyDown")(code);
        },
        keyUp: (code: string) => {
          heldKeys.delete(code);
          record("keyUp")(code);
        },
        mouseMove: record("mouseMove"),
        mouseDown: record("mouseDown"),
        mouseUp: record("mouseUp"),
        pointerMove: record("pointerMove"),
        pointerDown: record("pointerDown"),
        pointerUp: record("pointerUp"),
        gamepadButton: record("gamepadButton"),
        gamepadAxis: record("gamepadAxis"),
        clearAll: () => {
          heldKeys.clear();
          heldActions.clear();
          record("clearAll")();
        },
      },
      capture: {
        dataURL: () => Promise.resolve(`data:image/png;base64,frame-${frame}`),
      },
      getInputState: () => ({
        keys: [...heldKeys],
        actions: [...heldActions],
        mouse: { x: 0, y: 0, buttons: [], down: false },
        pointers: [],
        gamepad: { buttons: [], axes: [] },
      }),
      getSceneStack: () => [],
    },
    context: {
      tryResolve: (key: ServiceKey<unknown>) => {
        if (key.id === "inputManager") {
          return opts.actions === true
            ? {
                fireActionDown: (name: string) => {
                  heldActions.add(name);
                  record("actionDown")(name);
                },
                fireActionUp: (name: string) => {
                  heldActions.delete(name);
                  record("actionUp")(name);
                },
              }
            : undefined;
        }
        return key.id === "renderer" ? renderer : undefined;
      },
    },
  };

  return { calls, engine: engine as unknown as Engine, stepAsyncCalls };
}

/**
 * Enough of `RendererPlugin` for a capture. `stageBounds` past `textureLimit`
 * is what makes a content capture warn.
 */
function stubRenderer(opts: {
  stageBounds?: { width: number; height: number };
  textureLimit?: number;
}) {
  const worldRoot = {
    renderGroup: null as object | null,
    disableRenderGroup(): void {
      this.renderGroup = null;
    },
  };
  return {
    worldRoot,
    virtualSize: { width: 320, height: 180 },
    application: {
      stage: {
        getLocalBounds: () => opts.stageBounds ?? { width: 100, height: 100 },
      },
      renderer: {
        resolution: 1,
        screen: {
          clone: () => ({ x: 0, y: 0, width: 0, height: 0 }),
        },
        gl: {
          MAX_TEXTURE_SIZE: 0x0d33,
          getParameter: () => opts.textureLimit ?? 4_096,
        },
        extract: {
          canvas: () => {
            worldRoot.renderGroup ??= {};
            return { toDataURL: () => "data:image/png;base64,camera" };
          },
        },
      },
    },
  };
}

const SCENE = { name: "drop" } as unknown as Scene;

function stubAnimationFrames() {
  let requestId = 0;
  const waits = vi.fn((callback: FrameRequestCallback): number => {
    callback(0);
    return ++requestId;
  });
  vi.stubGlobal("requestAnimationFrame", waits);
  return waits;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runDrive", () => {
  it("passes the scene and the control values through", async () => {
    const { engine } = stubEngine();
    let seen: unknown;
    const result = await runDrive(engine, SCENE, { count: 3 }, async (ctx) => {
      seen = [ctx.scene, ctx.controls];
      await ctx.step();
    });
    expect(seen).toEqual([SCENE, { count: 3 }]);
    expect(result.ok).toBe(true);
    expect(result.framesUsed).toBe(1);
  });

  it("carries the callback's return value on the ok branch", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.step();
      return { hp: 7 };
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ hp: 7 });
  });

  it("counts every frame the run issued, however it asked for them", async () => {
    const { engine } = stubEngine();
    let ticks = 0;
    const result = await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.step(3);
      await ctx.input.tap("Space", 2);
      // Checked once before the first frame, so this takes three.
      const took = await ctx.until(() => ++ticks >= 4);
      ctx.expect(took).toBe(3);
    });
    expect(failure(result)).toBeUndefined();
    expect(result.framesUsed).toBe(8);
  });

  it("forwards per-call frame deltas and omits absent options", async () => {
    const { engine, stepAsyncCalls } = stubEngine();

    await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.step(3, { dtMs: 20 });
      await ctx.step(3);
      let checks = 0;
      const took = await ctx.until(() => ++checks >= 3, {
        maxFrames: 5,
        dtMs: 25,
      });
      ctx.expect(took).toBe(2);
    });

    expect(stepAsyncCalls).toEqual([
      [3, { dtMs: 20 }],
      [3],
      [1, { dtMs: 25 }],
      [1, { dtMs: 25 }],
    ]);
  });

  it("paces step, until and held input once per frame", async () => {
    const waits = stubAnimationFrames();
    const { engine } = stubEngine();

    const result = await runDrive(
      engine,
      SCENE,
      {},
      async (ctx) => {
        await ctx.step(2);
        ctx.expect(waits).toHaveBeenCalledTimes(2);

        let checks = 0;
        await ctx.until(() => ++checks >= 3);
        ctx.expect(waits).toHaveBeenCalledTimes(4);

        await ctx.input.hold("Space", 3);
        ctx.expect(waits).toHaveBeenCalledTimes(7);
      },
      { pace: "frame" },
    );

    expect(failure(result)).toBeUndefined();
  });

  it("does not wait for animation frames at immediate pace", async () => {
    const waits = stubAnimationFrames();
    const { engine } = stubEngine();

    await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.step(2);
      let checks = 0;
      await ctx.until(() => ++checks >= 3);
      await ctx.input.hold("Space", 2);
    });

    expect(waits).not.toHaveBeenCalled();
  });

  it("until resolves with the same frame count at both paces", async () => {
    stubAnimationFrames();
    const counts: number[] = [];

    for (const pace of ["immediate", "frame"] as const) {
      const { engine } = stubEngine();
      let checks = 0;
      const result = await runDrive(
        engine,
        SCENE,
        {},
        async (ctx) => {
          counts.push(await ctx.until(() => ++checks >= 4));
        },
        { pace },
      );
      expect(failure(result)).toBeUndefined();
    }

    expect(counts).toEqual([3, 3]);
  });

  it("captures through the view the run was given", async () => {
    const { engine } = stubEngine();

    const result = await runDrive(
      engine,
      SCENE,
      {},
      async (ctx) => {
        await ctx.capture("shot");
      },
      { captureView: "camera" },
    );

    expect(result.captures).toEqual([
      { label: "shot", dataUrl: "data:image/png;base64,camera" },
    ]);
  });

  it("carries a capture warning out once however many captures raised it", async () => {
    const { engine } = stubEngine({
      stageBounds: { width: 9_000, height: 9_000 },
      textureLimit: 4_096,
    });

    const result = await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.capture("first");
      await ctx.capture("second");
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("9000×9000");
    expect(result.captures).toHaveLength(2);
  });

  it("until reports its limit when the predicate stays false", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) =>
      ctx.until(() => false, { maxFrames: 2 }).then(() => undefined),
    );

    expect(failure(result)).toBe(
      "drive.until(): predicate still false after 2 frames.",
    );
  });

  it("reports a failed assertion as a result rather than a rejection", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) => {
      ctx.expect(1).toBe(2);
      return Promise.resolve();
    });
    expect(result.ok).toBe(false);
    expect(failure(result)).toContain("expected 1 to be 2");
  });

  it("keeps the label an assertion was given", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) => {
      ctx.expect(1, "hp after the hit").toBe(2);
      return Promise.resolve();
    });
    expect(failure(result)).toContain("hp after the hit");
  });

  it("carries the jest-style matchers `@vitest/expect` adds to chai", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) => {
      ctx.expect({ hp: 10, hits: 1 }).toEqual({
        hp: ctx.expect.any(Number),
        hits: 1,
      });
      return Promise.resolve();
    });
    expect(failure(result)).toBeUndefined();
  });

  it("reports what a run threw for any other reason", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, () => {
      throw new Error("no slime in the scene");
    });
    expect(result.ok).toBe(false);
    expect(failure(result)).toBe("no slime in the scene");
  });

  it("collects the screenshots the run asked for", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.capture("before");
      await ctx.step(2);
      await ctx.capture();
    });
    expect(result.captures).toEqual([
      { label: "before", dataUrl: "data:image/png;base64,frame-0" },
      { label: undefined, dataUrl: "data:image/png;base64,frame-2" },
    ]);
  });

  it("reports framesUsed live, counting frames issued directly through inspector.time too", async () => {
    const { engine } = stubEngine();
    const seen: number[] = [];
    await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.step(2);
      seen.push(ctx.framesUsed);
      await engine.inspector.time.stepAsync(3);
      seen.push(ctx.framesUsed);
    });
    expect(seen).toEqual([2, 5]);
  });

  it("captures the keys and scene stack held when the run ended", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) => {
      ctx.input.keyDown("KeyD");
      return Promise.resolve();
    });
    expect(result.state.keys).toEqual(["KeyD"]);
    expect(result.state.scenes).toEqual(engine.inspector.getSceneStack());
  });

  it("applies no frame budget when maxFrames is omitted", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.step(50_000);
    });
    expect(result.ok).toBe(true);
  });

  it("never times out when maxFrames is Infinity", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(
      engine,
      SCENE,
      {},
      async (ctx) => {
        await ctx.step(50_000);
      },
      { maxFrames: Infinity },
    );
    expect(result.ok).toBe(true);
  });

  it("ends a run that exceeds its frame budget with timedOut: true and framesUsed equal to the budget", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(
      engine,
      SCENE,
      {},
      async (ctx) => {
        for (;;) {
          await ctx.step(1);
        }
      },
      { maxFrames: 5 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.timedOut).toBe(true);
      expect(result.framesUsed).toBe(5);
    }
  });

  it("reports timedOut: false when the callback throws for its own reason", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(
      engine,
      SCENE,
      {},
      () => {
        throw new Error("no slime in the scene");
      },
      { maxFrames: 5 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.timedOut).toBe(false);
      expect(result.error).toBe("no slime in the scene");
    }
  });
});

describe("the frame budget's maxFrames option", () => {
  it("rejects a value that is not a non-negative integer or Infinity", async () => {
    const { engine } = stubEngine();
    for (const bad of [Number.NaN, -1, 1.5]) {
      await expect(
        runDrive(engine, SCENE, {}, async () => {}, { maxFrames: bad }),
      ).rejects.toThrow("maxFrames must be a non-negative integer or Infinity");
    }
  });

  it("accepts Infinity, which disables the budget on purpose", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, async () => {}, {
      maxFrames: Number.POSITIVE_INFINITY,
    });
    expect(result.ok).toBe(true);
  });
});

describe("input.whileHolding", () => {
  it("nests: the inner release leaves the outer key held", async () => {
    const { engine } = stubEngine();
    let midRunKeys: string[] | undefined;
    await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.input.whileHolding(["KeyA"], async () => {
        await ctx.input.whileHolding(["KeyB"], async () => {});
        midRunKeys = [...engine.inspector.getInputState().keys];
      });
    });
    expect(midRunKeys).toEqual(["KeyA"]);
  });

  it("resolves with what its callback returned", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, async (ctx) =>
      ctx.input.whileHolding(["KeyD"], () => ctx.until(() => true)),
    );
    expect(result).toMatchObject({ ok: true, value: 0 });
  });

  it("leaves a code the caller already holds down when it returns", async () => {
    const { engine } = stubEngine();
    let insideKeys: string[] | undefined;
    let afterInnerKeys: string[] | undefined;
    await runDrive(engine, SCENE, {}, async (ctx) => {
      await ctx.input.whileHolding(["KeyD"], async () => {
        await ctx.input.whileHolding(["KeyD", "Space"], async () => {
          insideKeys = [...engine.inspector.getInputState().keys].sort();
        });
        afterInnerKeys = [...engine.inspector.getInputState().keys];
      });
    });
    expect(insideKeys).toEqual(["KeyD", "Space"]);
    // The inner call repeated "KeyD", so it is the outer call's to release.
    expect(afterInnerKeys).toEqual(["KeyD"]);
  });

  it("releases exactly its own codes when fn throws, leaving other held keys alone", async () => {
    const { engine } = stubEngine();
    let keysAfterThrow: string[] | undefined;
    const result = await runDrive(engine, SCENE, {}, async (ctx) => {
      ctx.input.keyDown("KeyA");
      await expect(
        ctx.input.whileHolding(["KeyB"], async () => {
          throw new Error("maneuver failed");
        }),
      ).rejects.toThrow("maneuver failed");
      keysAfterThrow = [...engine.inspector.getInputState().keys];
    });
    expect(result.ok).toBe(true);
    expect(keysAfterThrow).toEqual(["KeyA"]);
  });
});

describe("the input facade", () => {
  it("advances no frame for the calls that do not touch the clock", async () => {
    const { calls, engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) => {
      ctx.input.keyDown("KeyA");
      ctx.input.keyUp("KeyA");
      ctx.input.mouseMove(10, 20);
      ctx.input.pointerDown(0);
      ctx.input.pointerUp(0);
      ctx.input.gamepadButton("GamepadA", true);
      ctx.input.gamepadAxis("leftX", 1);
      ctx.input.clearAll();
      return Promise.resolve();
    });
    expect(result.framesUsed).toBe(0);
    expect(calls).not.toContain("step");
  });

  it("holds a key for the frames asked for and releases it after", async () => {
    const { calls, engine } = stubEngine();
    await runDrive(engine, SCENE, {}, (ctx) => ctx.input.hold("Space", 3));
    expect(calls).toEqual([
      "keyDown(Space)",
      "step",
      "step",
      "step",
      "keyUp(Space)",
    ]);
  });

  it("taps for one frame unless told otherwise", async () => {
    const { calls, engine } = stubEngine();
    await runDrive(engine, SCENE, {}, (ctx) => ctx.input.tap("Space"));
    expect(calls).toEqual(["keyDown(Space)", "step", "keyUp(Space)"]);
  });

  it("sustains an action across the frames it covers", async () => {
    const { calls, engine } = stubEngine({ actions: true });
    await runDrive(engine, SCENE, {}, (ctx) => ctx.input.fireAction("jump", 2));
    expect(calls).toEqual([
      "actionDown(jump)",
      "step",
      "step",
      "actionUp(jump)",
    ]);
  });

  it("presses and releases an action without advancing anything", async () => {
    const { calls, engine } = stubEngine({ actions: true });
    const result = await runDrive(engine, SCENE, {}, (ctx) => {
      ctx.input.pressAction("aim");
      ctx.input.releaseAction("aim");
      return Promise.resolve();
    });
    expect(calls).toEqual(["actionDown(aim)", "actionUp(aim)"]);
    expect(result.framesUsed).toBe(0);
  });

  it("says which plugin is missing when a game has no input package", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) =>
      ctx.input.fireAction("jump"),
    );
    expect(failure(result)).toBe(
      "input.fireAction() requires InputPlugin to be active.",
    );
  });

  it("still runs a drive that never touches input", async () => {
    const { engine } = stubEngine();
    const result = await runDrive(engine, SCENE, {}, (ctx) => ctx.step(2));
    expect(result.ok).toBe(true);
  });
});
