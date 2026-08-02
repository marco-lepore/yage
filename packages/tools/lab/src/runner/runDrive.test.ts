import type { Engine, Scene, ServiceKey } from "@yagejs/core";
import { describe, expect, it } from "vitest";
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
function stubEngine(opts: { actions?: boolean } = {}) {
  const calls: string[] = [];
  let frame = 0;

  const step = (frames: number): void => {
    for (let i = 0; i < frames; i++) {
      frame++;
      calls.push("step");
    }
  };

  const time = {
    getFrame: () => frame,
    stepAsync: (frames = 1) => {
      step(frames);
      return Promise.resolve();
    },
    stepUntil: async (
      predicate: () => boolean,
      options?: { maxFrames?: number },
    ) => {
      if (predicate()) return 0;
      const maxFrames = options?.maxFrames ?? 600;
      for (let count = 1; count <= maxFrames; count++) {
        step(1);
        await Promise.resolve();
        if (predicate()) return count;
      }
      throw new Error("predicate still false");
    },
  };

  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(`${name}(${args.map(String).join(",")})`);
    };

  const events = { getLog: () => [] };

  const engine = {
    inspector: {
      time,
      events,
      input: {
        keyDown: record("keyDown"),
        keyUp: record("keyUp"),
        mouseMove: record("mouseMove"),
        mouseDown: record("mouseDown"),
        mouseUp: record("mouseUp"),
        pointerMove: record("pointerMove"),
        pointerDown: record("pointerDown"),
        pointerUp: record("pointerUp"),
        gamepadButton: record("gamepadButton"),
        gamepadAxis: record("gamepadAxis"),
        clearAll: record("clearAll"),
      },
      capture: {
        dataURL: () => Promise.resolve(`data:image/png;base64,frame-${frame}`),
      },
    },
    context: {
      tryResolve: (key: ServiceKey<unknown>) =>
        opts.actions === true && key.id === "inputManager"
          ? {
              fireActionDown: record("actionDown"),
              fireActionUp: record("actionUp"),
            }
          : undefined,
    },
  };

  return { calls, engine: engine as unknown as Engine };
}

const SCENE = { name: "drop" } as unknown as Scene;

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
