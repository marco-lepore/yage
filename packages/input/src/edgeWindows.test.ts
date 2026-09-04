import { Engine, Phase, System, SystemSchedulerKey } from "@yagejs/core";
import type { SystemScheduler } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { InputManager } from "./InputManager.js";
import { InputPlugin } from "./InputPlugin.js";
import { InputManagerKey, type SchedulerLike } from "./types.js";
import { setTestActionHeld } from "./test-action-source.js";

/** Records the result of an input query once per update of its phase. */
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

async function startEngine(): Promise<{
  engine: Engine;
  input: InputManager;
  scheduler: SystemScheduler;
}> {
  // 16ms fixed step so tick(8/16/32) gives exact zero/one/two-step frames.
  const engine = new Engine({ fixedTimestep: 0.016 });
  engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
  await engine.start();
  const input = engine.context.resolve(InputManagerKey);
  const scheduler = engine.context.resolve(SystemSchedulerKey);
  return { engine, input, scheduler };
}

describe("edge queries from a fixed-phase system", () => {
  it("a press in a frame that runs no fixed step is held for the next step, not lost", async () => {
    const { engine, input, scheduler } = await startEngine();
    const fixed = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustPressed("jump"),
    );
    const frame = new QueryReader(Phase.Update, () =>
      input.isJustPressed("jump"),
    );
    scheduler.add(fixed);
    scheduler.add(frame);

    input._enqueueKeyDown("Space");
    engine.loop.tick(8); // drains the press; accumulator below the step
    expect(fixed.readings).toEqual([]);
    expect(frame.readings).toEqual([true]);

    engine.loop.tick(8); // accumulator reaches 16ms: exactly one step
    expect(fixed.readings).toEqual([true]);
    expect(frame.readings).toEqual([true, false]);
    engine.destroy();
  });

  it("several fixed steps in one frame see one press exactly once", async () => {
    const { engine, input, scheduler } = await startEngine();
    const fixed = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustPressed("jump"),
    );
    scheduler.add(fixed);

    input._enqueueKeyDown("Space");
    engine.loop.tick(32); // two fixed steps in one frame
    expect(fixed.readings).toEqual([true, false]);

    engine.loop.tick(16); // a later step sees nothing
    expect(fixed.readings).toEqual([true, false, false]);
    engine.destroy();
  });

  it("frame-phase and fixed-phase readers each see the same press exactly once", async () => {
    const { engine, input, scheduler } = await startEngine();
    const fixed = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustPressed("jump"),
    );
    const frame = new QueryReader(Phase.Update, () =>
      input.isJustPressed("jump"),
    );
    scheduler.add(fixed);
    scheduler.add(frame);

    input._enqueueKeyDown("Space");
    engine.loop.tick(16); // one step, one frame
    engine.loop.tick(16);
    expect(fixed.readings).toEqual([true, false]);
    expect(frame.readings).toEqual([true, false]);
    engine.destroy();
  });

  it("a release crossing a zero-step frame reaches the next step as a tap", async () => {
    const { engine, input, scheduler } = await startEngine();
    const released = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustReleased("jump"),
    );
    const tapped = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustTapped("jump", 0.5),
    );
    scheduler.add(released);
    scheduler.add(tapped);

    input._enqueueKeyDown("Space");
    engine.loop.tick(16); // step 1: press lands
    input._enqueueKeyUp("Space");
    engine.loop.tick(8); // release drains; no step runs
    expect(released.readings).toEqual([false]);

    engine.loop.tick(8); // step 2 sees the release
    expect(released.readings).toEqual([false, true]);
    expect(tapped.readings).toEqual([false, true]);

    engine.loop.tick(16); // step 3: edge expired
    expect(released.readings).toEqual([false, true, false]);
    expect(tapped.readings).toEqual([false, true, false]);
    engine.destroy();
  });

  it("a synthetic tap spanning a zero-step frame shows both edges to the next step", async () => {
    const { engine, input, scheduler } = await startEngine();
    const pressed = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustPressed("jump"),
    );
    const released = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustReleased("jump"),
    );
    scheduler.add(pressed);
    scheduler.add(released);

    setTestActionHeld(input, "jump", true);
    engine.loop.tick(8); // zero-step frame: no step has seen the press yet
    setTestActionHeld(input, "jump", false);
    engine.loop.tick(8); // step 1 runs — its window spans both frames
    expect(pressed.readings).toEqual([true]);
    expect(released.readings).toEqual([true]);
    engine.destroy();
  });

  it("a fixed-phase poller that starts mid-hold sees no phantom crossing", async () => {
    const { engine, input, scheduler } = await startEngine();
    let armed = false;
    const fixed = new QueryReader(Phase.FixedUpdate, () =>
      armed ? input.isJustHeldFor("jump", 0.05) : false,
    );
    scheduler.add(fixed);

    input._enqueueKeyDown("Space");
    // The hold accrues far past the 50ms threshold with nobody polling.
    for (let i = 0; i < 10; i++) engine.loop.tick(16);

    // A consumer starts polling mid-hold (entity spawned, state entered).
    armed = true;
    engine.loop.tick(16);
    expect(fixed.readings.at(-1)).toBe(false);
    engine.destroy();
  });

  it("isJustHeldFor fires on exactly one step when the crossing frame runs two steps", async () => {
    const { engine, input, scheduler } = await startEngine();
    const fixed = new QueryReader(Phase.FixedUpdate, () =>
      input.isJustHeldFor("jump", 0.03),
    );
    const frame = new QueryReader(Phase.Update, () =>
      input.isJustHeldFor("jump", 0.03),
    );
    scheduler.add(fixed);
    scheduler.add(frame);

    input._enqueueKeyDown("Space");
    engine.loop.tick(16); // hold starts; 16ms is below the 30ms threshold
    expect(fixed.readings).toEqual([false]);
    expect(frame.readings).toEqual([false]);

    engine.loop.tick(32); // hold crosses 30ms in a frame with two steps
    expect(fixed.readings).toEqual([false, true, false]);
    expect(frame.readings).toEqual([false, true]);
    engine.destroy();
  });
});

describe("edge queries against a scheduler stub", () => {
  function stubbedManager(): {
    input: InputManager;
    ctx: { currentPhase: Phase | null; fixedStepIndex: number };
  } {
    const input = new InputManager();
    input.setActionMap({ jump: ["Space"] });
    const ctx: { currentPhase: Phase | null; fixedStepIndex: number } = {
      currentPhase: null,
      fixedStepIndex: 0,
    };
    input._setScheduler(ctx satisfies SchedulerLike);
    return { input, ctx };
  }

  it("the step window is shared, not consumed: every reader in a step sees the press", () => {
    const { input, ctx } = stubbedManager();
    input.fireKeyDown("Space");

    ctx.currentPhase = Phase.FixedUpdate;
    ctx.fixedStepIndex = 1;
    expect(input.isJustPressed("jump")).toBe(true);
    expect(input.isJustPressed("jump")).toBe(true);

    ctx.fixedStepIndex = 2;
    expect(input.isJustPressed("jump")).toBe(false);
  });

  it("the step window survives a frame clear; the frame window does not", () => {
    const { input, ctx } = stubbedManager();
    input.fireKeyDown("Space");
    input._clearFrameState(); // end of a frame that ran no fixed step

    expect(input.isJustPressed("jump")).toBe(false);
    ctx.currentPhase = Phase.FixedUpdate;
    ctx.fixedStepIndex = 1;
    expect(input.isJustPressed("jump")).toBe(true);
  });

  it("an edge fired after a frame's steps belongs to the next step", () => {
    const { input, ctx } = stubbedManager();
    // Two steps have already run this frame; a frame-phase system fires now.
    ctx.fixedStepIndex = 2;
    input.fireAction("jump");

    ctx.currentPhase = Phase.FixedUpdate;
    ctx.fixedStepIndex = 3;
    expect(input.isJustPressed("jump")).toBe(true);
    ctx.fixedStepIndex = 4;
    expect(input.isJustPressed("jump")).toBe(false);
  });

  it("an unobserved edge expires once its step has passed", () => {
    const { input, ctx } = stubbedManager();
    input.fireKeyDown("Space"); // tag 0: belongs to step 1
    ctx.fixedStepIndex = 1; // step 1 runs with no input reads

    ctx.currentPhase = Phase.FixedUpdate;
    ctx.fixedStepIndex = 2;
    expect(input.isJustPressed("jump")).toBe(false);
  });

  it("a release and re-press during a polling gap still fires the new hold's crossing once", () => {
    const { input, ctx } = stubbedManager();

    // Hold #1 crossed the 200ms threshold long before the first poll.
    input.fireKeyDown("Space");
    input._advanceTime(500);
    ctx.currentPhase = Phase.FixedUpdate;
    ctx.fixedStepIndex = 1;
    expect(input.isJustHeldFor("jump", 0.2)).toBe(false); // no phantom crossing

    // Steps 2..5 run with no hold polls. During the gap the player releases
    // and re-presses; the new hold crosses the threshold on its own.
    ctx.currentPhase = null;
    input.fireKeyUp("Space");
    input.fireKeyDown("Space");
    input._advanceTime(300);
    ctx.currentPhase = Phase.FixedUpdate;

    const fired: boolean[] = [];
    for (let step = 6; step < 10; step++) {
      ctx.fixedStepIndex = step;
      fired.push(input.isJustHeldFor("jump", 0.2));
      input._advanceTime(16);
    }
    expect(fired).toEqual([true, false, false, false]);
  });
});
