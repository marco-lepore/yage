import { Engine, Phase, System, SystemSchedulerKey } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { InputManager } from "./InputManager.js";
import { InputPlugin } from "./InputPlugin.js";
import { InputManagerKey } from "./types.js";
import type { ActionMapDefinition, PressRepeatOptions } from "./types.js";
import { setTestActionHeld } from "./test-action-source.js";

const DOWN = "move-down";

/** A standalone manager with one bound action, driven frame by frame. */
function menuInput(
  actions: ActionMapDefinition = { [DOWN]: ["ArrowDown"] },
): InputManager {
  const input = new InputManager();
  input.setActionMap(actions);
  return input;
}

/**
 * One rendered frame in the engine's own order: the poll advances the input
 * clock, the caller queries, and the end-of-frame clear samples the hold
 * baseline the next frame compares against.
 */
function frame<T>(input: InputManager, ms: number, read: () => T): T {
  input._advanceTime(ms);
  const reading = read();
  input._clearFrameState();
  return reading;
}

function runFrames<T>(
  input: InputManager,
  count: number,
  ms: number,
  read: () => T,
): T[] {
  const readings: T[] = [];
  for (let i = 0; i < count; i++) readings.push(frame(input, ms, read));
  return readings;
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

/** Frame indices of every reading after the press edge. */
function repeatIndices(readings: readonly boolean[]): number[] {
  const indices: number[] = [];
  readings.forEach((reading, index) => {
    if (reading && index > 0) indices.push(index);
  });
  return indices;
}

describe("hold-to-repeat on isJustPressed", () => {
  it("waits the delay, fires once there, then fires on the interval", () => {
    const input = menuInput();
    // 50ms frames against the 0.35s / 0.1s defaults: the hold reads 50, 100,
    // … so it lands on 350 exactly and then on every 100 after it.
    const repeat: PressRepeatOptions = { repeat: true };
    input._onKeyDown("ArrowDown");

    const readings = runFrames(input, 11, 50, () => ({
      repeating: input.isJustPressed(DOWN, repeat),
      plain: input.isJustPressed(DOWN),
    }));

    expect(readings.map((reading) => reading.repeating)).toEqual([
      true, // the press edge
      false,
      false,
      false,
      false,
      false,
      true, // hold 350ms: the delay
      false,
      true, // hold 450ms
      false,
      true, // hold 550ms
    ]);
    // One argument is the press edge and nothing else.
    expect(readings.map((reading) => reading.plain)).toEqual([
      true,
      ...Array.from({ length: 10 }, () => false),
    ]);
  });

  it("starts the delay over after a release", () => {
    const input = menuInput();
    const repeat: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.2,
      repeatInterval: 0.1,
    };
    input._onKeyDown("ArrowDown");

    expect(
      runFrames(input, 6, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([true, false, false, true, false, true]);

    input._onKeyUp("ArrowDown");
    expect(frame(input, 50, () => input.isJustPressed(DOWN, repeat))).toBe(
      false,
    );

    input._onKeyDown("ArrowDown");
    expect(
      runFrames(input, 5, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([true, false, false, true, false]);
  });

  it("reports one edge for a frame longer than the interval, and no catch-up", () => {
    const input = menuInput();
    const repeat: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.1,
      repeatInterval: 0.05,
    };
    input._onKeyDown("ArrowDown");
    expect(frame(input, 10, () => input.isJustPressed(DOWN, repeat))).toBe(
      true,
    );

    // A one-second hitch crosses eighteen repeat thresholds at once.
    expect(frame(input, 1000, () => input.isJustPressed(DOWN, repeat))).toBe(
      true,
    );
    // The frames after it answer on the ordinary cadence rather than paying
    // back the crossings the hitch swallowed.
    expect(
      runFrames(input, 3, 10, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([false, false, false]);
    expect(frame(input, 10, () => input.isJustPressed(DOWN, repeat))).toBe(
      true,
    );
  });

  it("gives two callers of one action their own cadence", () => {
    const input = menuInput();
    const fast: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.1,
      repeatInterval: 0.1,
    };
    const slow: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.2,
      repeatInterval: 0.2,
    };
    input._onKeyDown("ArrowDown");

    const readings = runFrames(input, 9, 50, () => ({
      fast: input.isJustPressed(DOWN, fast),
      slow: input.isJustPressed(DOWN, slow),
    }));

    expect(readings.map((reading) => reading.fast)).toEqual([
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(readings.map((reading) => reading.slow)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("repeats a gamepad stick direction like a key", () => {
    // A push past the stick's direction threshold arrives as an ordinary key
    // edge, so it carries an ordinary hold start.
    const input = menuInput({ [DOWN]: ["GamepadLeftStickDown"] });
    const repeat: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.2,
      repeatInterval: 0.1,
    };

    input.fireGamepadButton("GamepadLeftStickDown", true);
    expect(
      runFrames(input, 6, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([true, false, false, true, false, true]);

    input.fireGamepadButton("GamepadLeftStickDown", false);
    expect(frame(input, 50, () => input.isJustPressed(DOWN, repeat))).toBe(
      false,
    );
  });

  it("does not re-fire when the longest-held binding of a chord releases", () => {
    const input = menuInput({ [DOWN]: ["ArrowDown", "KeyS"] });
    const repeat: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.2,
      repeatInterval: 0.1,
    };
    input._onKeyDown("ArrowDown");
    expect(
      runFrames(input, 8, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([true, false, false, true, false, true, false, true]);

    // A second binding of a held action is its own press edge.
    input._onKeyDown("KeyS");
    expect(frame(input, 50, () => input.isJustPressed(DOWN, repeat))).toBe(
      true,
    );

    // The hold drops to the newer key's, far below the baseline the released
    // one left behind, so no threshold is crossed.
    input._onKeyUp("ArrowDown");
    expect(
      runFrames(input, 2, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([false, false]);

    // The surviving press reaches the delay on its own hold.
    expect(frame(input, 50, () => input.isJustPressed(DOWN, repeat))).toBe(
      true,
    );
  });

  it("reports no catch-up edge when a disabled group is re-enabled mid-hold", () => {
    const input = menuInput();
    input.setGroups({ menu: [DOWN] });
    const repeat: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.2,
      repeatInterval: 0.1,
    };
    input._onKeyDown("ArrowDown");
    expect(
      runFrames(input, 4, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([true, false, false, true]);

    input.disableGroup("menu");
    expect(
      runFrames(input, 6, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([false, false, false, false, false, false]);

    // The baseline keeps counting while the group is off, so the hold resumes
    // its cadence rather than paying back the repeats it missed.
    input.enableGroup("menu");
    expect(
      runFrames(input, 2, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([false, true]);
  });

  it("counts repeats on a scene clock while the raw clock keeps its own", () => {
    const input = menuInput();
    const clock = { elapsed: 0 };
    input._registerClock(clock);
    const onRaw: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.2,
      repeatInterval: 0.1,
    };
    const onScene: PressRepeatOptions = { ...onRaw, clock };
    input._onKeyDown("ArrowDown");

    // The scene runs at half speed: 25ms of simulation per 50ms frame.
    const raw: boolean[] = [];
    const scene: boolean[] = [];
    for (let i = 1; i <= 8; i++) {
      input._advanceTime(50);
      clock.elapsed = i * 0.025;
      raw.push(input.isJustPressed(DOWN, onRaw));
      scene.push(input.isJustPressed(DOWN, onScene));
      input._clearFrameState();
    }

    expect(raw).toEqual([true, false, false, true, false, true, false, true]);
    expect(scene).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("throws for an unregistered clock, naming the query", () => {
    const input = menuInput();
    const clock = { elapsed: 0 };
    expect(() => input.isJustPressed(DOWN, { repeat: true, clock })).toThrow(
      /isJustPressed\(\): the given clock is not registered/,
    );
  });
});

describe("hold-to-repeat under fixed steps", () => {
  it("answers a fixed-step reader on the same schedule as a frame reader", async () => {
    // 16ms fixed step so each tick(16) runs exactly one step.
    const engine = new Engine({ fixedTimestep: 0.016 });
    engine.use(new InputPlugin({ actions: { [DOWN]: ["ArrowDown"] } }));
    await engine.start();
    const input = engine.context.resolve(InputManagerKey);
    const scheduler = engine.context.resolve(SystemSchedulerKey);
    const repeat: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0.1,
      repeatInterval: 0.05,
    };
    const fixed = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustPressed(DOWN, repeat),
    );
    const perFrame = new QueryReader(Phase.Update, () =>
      input.isJustPressed(DOWN, repeat),
    );
    scheduler.add(fixed);
    scheduler.add(perFrame);

    setTestActionHeld(input, DOWN, true);
    for (let i = 0; i < 20; i++) engine.loop.tick(16);

    expect(fixed.readings).toEqual(perFrame.readings);
    expect(fixed.readings[0]).toBe(true);

    // The 0.1s delay is more than five 16ms steps away, and the repeats after
    // it land on one steady cadence.
    const repeats = repeatIndices(fixed.readings);
    expect(repeats.length).toBeGreaterThan(2);
    expect(repeats[0]).toBeGreaterThan(5);
    const gaps = repeats.slice(1).map((index, i) => index - (repeats[i] ?? 0));
    expect(new Set(gaps).size).toBe(1);
    engine.destroy();
  });
});

describe("repeat timing validation", () => {
  it("names the offending value", () => {
    const input = menuInput();

    expect(() =>
      input.isJustPressed(DOWN, { repeat: true, repeatInterval: 0 }),
    ).toThrow(
      "InputManager.isJustPressed: repeatInterval must be a finite number of seconds above 0, got 0.",
    );
    expect(() =>
      input.isJustPressed(DOWN, { repeat: true, repeatInterval: -1 }),
    ).toThrow(
      "repeatInterval must be a finite number of seconds above 0, got -1.",
    );
    expect(() =>
      input.isJustPressed(DOWN, { repeat: true, repeatDelay: NaN }),
    ).toThrow(
      "InputManager.isJustPressed: repeatDelay must be a finite number of seconds at or above 0, got NaN.",
    );
    expect(() =>
      input.isJustPressed(DOWN, { repeat: true, repeatDelay: -1 }),
    ).toThrow(
      "repeatDelay must be a finite number of seconds at or above 0, got -1.",
    );
  });

  it("throws for a timing written without the repeat flag", () => {
    const input = menuInput();

    expect(() => input.isJustPressed(DOWN, { repeatInterval: 0 })).toThrow(
      "repeatInterval must be a finite number of seconds above 0, got 0.",
    );
    expect(() => input.isJustPressed(DOWN, { repeatDelay: -1 })).toThrow(
      "repeatDelay must be a finite number of seconds at or above 0, got -1.",
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

  it("accepts a zero delay, which starts the cadence at the press", () => {
    const input = menuInput();
    const repeat: PressRepeatOptions = {
      repeat: true,
      repeatDelay: 0,
      repeatInterval: 0.1,
    };
    input._onKeyDown("ArrowDown");

    expect(
      runFrames(input, 3, 50, () => input.isJustPressed(DOWN, repeat)),
    ).toEqual([true, true, false]);
  });
});
