import { Engine, Phase, System, SystemSchedulerKey } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { InputManager } from "./InputManager.js";
import { InputPlugin } from "./InputPlugin.js";
import { InputManagerKey } from "./types.js";
import type { ActionMapDefinition, PressRepeatOptions } from "./types.js";
import { setTestActionHeld } from "./test-action-source.js";

const DOWN = "move-down";
/** A 0.2s delay and a 0.1s interval: edges at frames 0, 3, 5, 7 of 50ms. */
const REPEAT: PressRepeatOptions = {
  repeat: true,
  repeatDelay: 0.2,
  repeatInterval: 0.1,
};

function menuInput(
  actions: ActionMapDefinition = { [DOWN]: ["ArrowDown"] },
): InputManager {
  const input = new InputManager();
  input.setActionMap(actions);
  return input;
}

/** One frame in engine order: advance the clock, query, clear frame state. */
function frame(input: InputManager, ms: number, read: () => boolean): boolean {
  input._advanceTime(ms);
  const reading = read();
  input._clearFrameState();
  return reading;
}

/** Reads `count` frames of `ms` each: "x" for an edge, "." for none. */
function frames(
  input: InputManager,
  count: number,
  ms: number,
  options?: PressRepeatOptions,
): string {
  let pattern = "";
  for (let i = 0; i < count; i++) {
    pattern += frame(input, ms, () => input.isJustPressed(DOWN, options))
      ? "x"
      : ".";
  }
  return pattern;
}

/** Records a query's answer once per update of its phase. */
class QueryReader extends System {
  readonly phase: Phase;
  readings: boolean[] = [];

  constructor(
    phase: Phase,
    private readonly query: () => boolean,
  ) {
    super();
    this.phase = phase;
  }

  update(): void {
    this.readings.push(this.query());
  }
}

describe("hold-to-repeat on isJustPressed", () => {
  it.each<[string, PressRepeatOptions | undefined, string]>([
    ["no options: the press edge only", undefined, "x.........."],
    ["the 0.35s / 0.1s defaults", { repeat: true }, "x.....x.x.x"],
    ["a 0.2s delay and 0.1s interval", REPEAT, "x..x.x.x.x."],
    [
      "a zero delay, which starts the cadence at the press",
      { repeat: true, repeatDelay: 0, repeatInterval: 0.1 },
      "xx.x.x.x.x.",
    ],
  ])("over 50ms frames reports %s", (_name, options, expected) => {
    const input = menuInput();
    input._onKeyDown("ArrowDown");
    expect(frames(input, 11, 50, options)).toBe(expected);
  });

  it("gives two callers of one action their own cadence", () => {
    const input = menuInput();
    const slow = { repeat: true, repeatDelay: 0.2, repeatInterval: 0.2 };
    input._onKeyDown("ArrowDown");

    let fastEdges = "";
    let slowEdges = "";
    for (let i = 0; i < 9; i++) {
      input._advanceTime(50);
      fastEdges += input.isJustPressed(DOWN, REPEAT) ? "x" : ".";
      slowEdges += input.isJustPressed(DOWN, slow) ? "x" : ".";
      input._clearFrameState();
    }

    expect(fastEdges).toBe("x..x.x.x.");
    expect(slowEdges).toBe("x..x...x.");
  });

  it("starts the delay over after a release", () => {
    const input = menuInput();
    input._onKeyDown("ArrowDown");
    expect(frames(input, 6, 50, REPEAT)).toBe("x..x.x");

    input._onKeyUp("ArrowDown");
    expect(frames(input, 1, 50, REPEAT)).toBe(".");

    input._onKeyDown("ArrowDown");
    expect(frames(input, 5, 50, REPEAT)).toBe("x..x.");
  });

  it("reports one edge for a frame longer than the interval, and no catch-up", () => {
    const input = menuInput();
    const repeat = { repeat: true, repeatDelay: 0.1, repeatInterval: 0.05 };
    input._onKeyDown("ArrowDown");
    expect(frames(input, 1, 10, repeat)).toBe("x");

    // A one-second frame crosses eighteen repeat thresholds at once.
    expect(frames(input, 1, 1000, repeat)).toBe("x");
    expect(frames(input, 4, 10, repeat)).toBe("...x");
  });

  it("repeats a gamepad stick direction like a key", () => {
    const input = menuInput({ [DOWN]: ["GamepadLeftStickDown"] });

    input.fireGamepadButton("GamepadLeftStickDown", true);
    expect(frames(input, 6, 50, REPEAT)).toBe("x..x.x");

    input.fireGamepadButton("GamepadLeftStickDown", false);
    expect(frames(input, 1, 50, REPEAT)).toBe(".");
  });

  it("does not re-fire when the longest-held binding of a chord releases", () => {
    const input = menuInput({ [DOWN]: ["ArrowDown", "KeyS"] });
    input._onKeyDown("ArrowDown");
    expect(frames(input, 8, 50, REPEAT)).toBe("x..x.x.x");

    // A second binding of a held action is its own press edge.
    input._onKeyDown("KeyS");
    expect(frames(input, 1, 50, REPEAT)).toBe("x");

    // The hold drops to the newer key's, which reaches the delay on its own.
    input._onKeyUp("ArrowDown");
    expect(frames(input, 3, 50, REPEAT)).toBe("..x");
  });

  it("reports no catch-up edge when a disabled group is re-enabled mid-hold", () => {
    const input = menuInput();
    input.setGroups({ menu: [DOWN] });
    input._onKeyDown("ArrowDown");
    expect(frames(input, 4, 50, REPEAT)).toBe("x..x");

    input.disableGroup("menu");
    expect(frames(input, 6, 50, REPEAT)).toBe("......");

    input.enableGroup("menu");
    expect(frames(input, 2, 50, REPEAT)).toBe(".x");
  });

  it("counts repeats on a scene clock while the raw clock keeps its own", () => {
    const input = menuInput();
    const clock = { elapsed: 0 };
    input._registerClock(clock);
    const onScene: PressRepeatOptions = { ...REPEAT, clock };
    input._onKeyDown("ArrowDown");

    // The scene runs at half speed: 25ms of simulation per 50ms frame.
    let raw = "";
    let scene = "";
    for (let i = 1; i <= 8; i++) {
      input._advanceTime(50);
      clock.elapsed = i * 0.025;
      raw += input.isJustPressed(DOWN, REPEAT) ? "x" : ".";
      scene += input.isJustPressed(DOWN, onScene) ? "x" : ".";
      input._clearFrameState();
    }

    expect(raw).toBe("x..x.x.x");
    expect(scene).toBe("x......x");
  });

  it("throws for an unregistered clock, naming the query", () => {
    const clock = { elapsed: 0 };
    expect(() =>
      menuInput().isJustPressed(DOWN, { repeat: true, clock }),
    ).toThrow(/isJustPressed\(\): the given clock is not registered/);
  });

  it("answers a fixed-step reader on the same schedule as a frame reader", async () => {
    // 16ms fixed step so each tick(16) runs exactly one step.
    const engine = new Engine({ fixedTimestep: 0.016 });
    engine.use(new InputPlugin({ actions: { [DOWN]: ["ArrowDown"] } }));
    await engine.start();
    const input = engine.context.resolve(InputManagerKey);
    const scheduler = engine.context.resolve(SystemSchedulerKey);
    const repeat = { repeat: true, repeatDelay: 0.1, repeatInterval: 0.05 };
    const query = (): boolean => input.isJustPressed(DOWN, repeat);
    const fixed = new QueryReader(Phase.FixedUpdate, query);
    const perFrame = new QueryReader(Phase.Update, query);
    scheduler.add(fixed);
    scheduler.add(perFrame);

    setTestActionHeld(input, DOWN, true);
    for (let i = 0; i < 20; i++) engine.loop.tick(16);

    expect(fixed.readings).toEqual(perFrame.readings);
    expect(fixed.readings[0]).toBe(true);

    // The repeats start after the delay and land on one steady cadence.
    const repeats = fixed.readings.flatMap((edge, i) =>
      edge && i > 0 ? [i] : [],
    );
    expect(repeats.length).toBeGreaterThan(2);
    expect(repeats[0]).toBeGreaterThan(5);
    const gaps = repeats.slice(1).map((index, i) => index - (repeats[i] ?? 0));
    expect(new Set(gaps).size).toBe(1);
    engine.destroy();
  });
});

describe("repeat timing validation", () => {
  const interval = "repeatInterval must be a finite number of seconds above 0";
  const delay = "repeatDelay must be a finite number of seconds at or above 0";

  it.each<[PressRepeatOptions, string]>([
    [{ repeat: true, repeatInterval: 0 }, `${interval}, got 0.`],
    [{ repeat: true, repeatInterval: -1 }, `${interval}, got -1.`],
    [{ repeat: true, repeatDelay: NaN }, `${delay}, got NaN.`],
    [{ repeat: true, repeatDelay: -1 }, `${delay}, got -1.`],
    // A timing written without the repeat flag is checked too.
    [{ repeatInterval: 0 }, `${interval}, got 0.`],
    [{ repeatDelay: -1 }, `${delay}, got -1.`],
  ])("throws for %o, naming the value", (options, message) => {
    expect(() => menuInput().isJustPressed(DOWN, options)).toThrow(
      `InputManager.isJustPressed: ${message}`,
    );
  });

  it("throws whatever the action's group state", () => {
    const input = menuInput();
    input.setGroups({ menu: [DOWN] });
    input.disableGroup("menu");

    expect(input.isJustPressed(DOWN)).toBe(false);
    expect(() =>
      input.isJustPressed(DOWN, { repeat: true, repeatInterval: 0 }),
    ).toThrow(/repeatInterval/);
  });
});
