import {
  Engine,
  Phase,
  Scene,
  SceneTime,
  SceneTimeKey,
  System,
  SystemSchedulerKey,
  advanceFrames,
  createMockScene,
} from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { InputManager } from "./InputManager.js";
import { InputPlugin } from "./InputPlugin.js";
import { InputManagerKey } from "./types.js";

class GameScene extends Scene {
  readonly name = "game";
}

/** Records a query's answer once per fixed step, from inside the step. */
class QueryReader extends System {
  readonly phase = Phase.FixedUpdate;
  readings: boolean[] = [];

  constructor(private readonly query: () => boolean) {
    super();
  }

  update(): void {
    this.readings.push(this.query());
  }
}

/** Pauses the scene below it, like a pause menu. */
class PauseScene extends Scene {
  readonly name = "pause";
}

async function startEngine(): Promise<Engine> {
  const engine = new Engine();
  engine.use(new InputPlugin({ actions: { charge: ["Space"] } }));
  await engine.start();
  return engine;
}

/** A manager with one action and one registered clock, both driven by hand. */
function setup(): { input: InputManager; clock: { elapsed: number } } {
  const input = new InputManager();
  input.setActionMap({ charge: ["Space"] });
  const clock = { elapsed: 0 };
  input._registerClock(clock);
  return { input, clock };
}

describe("hold durations on a scene clock", () => {
  it("stops accruing while a pause menu is up", async () => {
    const engine = await startEngine();
    const game = new GameScene();
    await engine.scenes.push(game);
    const input = engine.context.resolve(InputManagerKey);
    const clock = game.tryResolveScoped(SceneTimeKey);
    if (!clock) throw new Error("Expected the engine to register a SceneTime");

    input.fireActionDown("charge");
    advanceFrames(engine, 6);
    const beforePause = input.getHoldDuration("charge", { clock });
    expect(beforePause).toBeGreaterThan(0);

    // The game scene leaves activeScenes, so the engine stops ticking its
    // SceneTime. InputPollSystem is global, so the raw clock keeps running.
    await engine.scenes.push(new PauseScene());
    advanceFrames(engine, 30);

    expect(input.getHoldDuration("charge", { clock })).toBe(beforePause);
    expect(input.getHoldDuration("charge")).toBeGreaterThan(beforePause);

    // Back in the game, the hold resumes on the scene's own time.
    await engine.scenes.pop();
    advanceFrames(engine, 6);
    expect(input.getHoldDuration("charge", { clock })).toBeGreaterThan(
      beforePause,
    );
    engine.destroy();
  });

  it("holds the duration while the scene is frozen", () => {
    const { scene } = createMockScene();
    const clock = new SceneTime(scene);
    const input = new InputManager();
    input.setActionMap({ charge: ["Space"] });
    input._registerClock(clock);

    input.fireActionDown("charge");
    clock._tick(0.3);
    input._advanceTime(300);

    clock.freezeFor(1);
    // A frozen scene still ticks — it just accrues nothing.
    clock._tick(0.5);
    input._advanceTime(500);

    expect(input.getHoldDuration("charge", { clock })).toBeCloseTo(0.3, 5);
    expect(input.getHoldDuration("charge")).toBe(0.8);
  });

  it("scales the duration with the scene's time scale", () => {
    const { input, clock } = setup();
    input._onKeyDown("Space");

    input._advanceTime(400);
    clock.elapsed = 0.2; // half speed

    expect(input.getHoldDuration("charge", { clock })).toBe(0.2);
    expect(input.isHeldFor("charge", 0.3, { clock })).toBe(false);
    expect(input.isHeldFor("charge", 0.3)).toBe(true);
  });

  it("crosses the isJustHeldFor threshold once on scene time", () => {
    const { input, clock } = setup();
    input._onKeyDown("Space");

    // The raw clock is already past the threshold; the scene clock is not.
    input._advanceTime(600);
    clock.elapsed = 0.1;
    expect(input.isJustHeldFor("charge", 0.5, { clock })).toBe(false);
    expect(input.isJustHeldFor("charge", 0.5)).toBe(true);
    input._clearFrameState();

    clock.elapsed = 0.5;
    expect(input.isJustHeldFor("charge", 0.5, { clock })).toBe(true);
    input._clearFrameState();

    clock.elapsed = 0.9;
    expect(input.isJustHeldFor("charge", 0.5, { clock })).toBe(false);
  });

  it("reports the release length on each clock", () => {
    const { input, clock } = setup();
    input._onKeyDown("Space");

    input._advanceTime(1000);
    clock.elapsed = 0.25;
    input._onKeyUp("Space");

    expect(input.getReleaseDuration("charge", { clock })).toBe(0.25);
    expect(input.getReleaseDuration("charge")).toBe(1);
    // A press that lasts a second of wall time but a quarter of playing time
    // is a tap on the scene clock and a long press on the raw one.
    expect(input.isJustTapped("charge", 0.3, { clock })).toBe(true);
    expect(input.isJustTapped("charge", 0.3)).toBe(false);
    expect(input.isJustReleasedAfter("charge", 0.5, { clock })).toBe(false);
    expect(input.isJustReleasedAfter("charge", 0.5)).toBe(true);
  });

  it("starts an already-held press from zero on a clock registered mid-hold", () => {
    const input = new InputManager();
    input.setActionMap({ charge: ["Space"] });
    input._onKeyDown("Space");
    input._advanceTime(700);

    const clock = { elapsed: 4 };
    input._registerClock(clock);

    expect(input.getHoldDuration("charge", { clock })).toBe(0);
    clock.elapsed = 4.2;
    expect(input.getHoldDuration("charge", { clock })).toBeCloseTo(0.2, 5);
    expect(input.getHoldDuration("charge")).toBe(0.7);
  });

  it("forgets a clock once it is unregistered", () => {
    const { input, clock } = setup();
    input._onKeyDown("Space");
    input._unregisterClock(clock);

    expect(() => input.getHoldDuration("charge", { clock })).toThrow(/clock/);
  });

  it("throws for an unregistered clock on every duration query, naming that query", () => {
    const input = new InputManager();
    input.setActionMap({ charge: ["Space"] });
    const clock = { elapsed: 0 };

    // Each query names itself, so the message points at the call the developer
    // wrote rather than at whichever helper it delegates to, and says a hold is
    // what could not be measured.
    expect(() => input.getHoldDuration("charge", { clock })).toThrow(
      /getHoldDuration\(\): the given clock is not registered, so no hold can be measured on it\./,
    );
    expect(() => input.isHeldFor("charge", 0.1, { clock })).toThrow(
      /isHeldFor\(\)/,
    );
    expect(() => input.isJustHeldFor("charge", 0.1, { clock })).toThrow(
      /isJustHeldFor\(\)/,
    );
    expect(() => input.getReleaseDuration("charge", { clock })).toThrow(
      /getReleaseDuration\(\)/,
    );
    expect(() => input.isJustTapped("charge", 0.1, { clock })).toThrow(
      /isJustTapped\(\)/,
    );
    expect(() => input.isJustReleasedAfter("charge", 0.1, { clock })).toThrow(
      /isJustReleasedAfter\(\)/,
    );
  });

  it("reports nothing for a release the clock never measured", () => {
    const input = new InputManager();
    input.setActionMap({ charge: ["Space"] });
    input._onKeyDown("Space");
    input._advanceTime(2000);
    input._onKeyUp("Space");

    // The scene arrives after the release edge, so its clock holds no length
    // for it. A two-second hold must not read as an instant tap there.
    const clock = { elapsed: 0 };
    input._registerClock(clock);

    expect(input.isJustReleased("charge")).toBe(true);
    expect(input.getReleaseDuration("charge")).toBe(2);
    expect(input.getReleaseDuration("charge", { clock })).toBe(0);
    expect(input.isJustTapped("charge", 0.1, { clock })).toBe(false);
    expect(input.isJustReleasedAfter("charge", 0.3, { clock })).toBe(false);
    // A zero threshold separates "no length here" from "held for no time": a
    // missing length counted as 0 seconds would clear it.
    expect(input.isJustReleasedAfter("charge", 0, { clock })).toBe(false);
  });

  it("reports nothing for a release that landed while the action was disabled", () => {
    const input = new InputManager();
    input.setActionMap({ charge: ["Space"] });
    input.setGroups({ combat: ["charge"] });
    input._onKeyDown("Space");
    input._advanceTime(2000);

    input.disableGroup("combat");
    input._onKeyUp("Space");
    input.enableGroup("combat");

    // The key's release edge stays visible, but no clock recorded a length for
    // it, so re-enabling the group must not turn a two-second hold into a tap.
    expect(input.isJustReleased("charge")).toBe(true);
    expect(input.getReleaseDuration("charge")).toBe(0);
    expect(input.isJustTapped("charge", 0.1)).toBe(false);
    expect(input.isJustReleasedAfter("charge", 0)).toBe(false);
  });

  it("keeps a synthetic hold on scene time", () => {
    const { input, clock } = setup();
    input.fireActionDown("charge");

    input._advanceTime(500);
    clock.elapsed = 0.2;
    expect(input.getHoldDuration("charge", { clock })).toBe(0.2);

    input.fireActionUp("charge");
    expect(input.getReleaseDuration("charge", { clock })).toBe(0.2);
    expect(input.getReleaseDuration("charge")).toBe(0.5);
  });

  it("measures a hold across two bound keys on the scene clock", () => {
    const input = new InputManager();
    input.setActionMap({ charge: ["Space", "Enter"] });
    const clock = { elapsed: 0 };
    input._registerClock(clock);

    input._onKeyDown("Space");
    clock.elapsed = 0.2;
    input._advanceTime(200);
    input._onKeyDown("Enter");
    clock.elapsed = 0.5;
    input._advanceTime(300);

    // Space has been down for 0.5s of scene time, Enter for 0.3s.
    expect(input.getHoldDuration("charge", { clock })).toBe(0.5);
  });
});

describe("hold-duration clocks under fixed steps", () => {
  it("gives each clock its own crossing baseline", async () => {
    // 16ms fixed step so each tick(16) runs exactly one step.
    const engine = new Engine({ fixedTimestep: 0.016 });
    engine.use(new InputPlugin({ actions: { charge: ["Space"] } }));
    await engine.start();
    const game = new GameScene();
    await engine.scenes.push(game);
    const input = engine.context.resolve(InputManagerKey);
    const scheduler = engine.context.resolve(SystemSchedulerKey);
    const clock = game.tryResolveScoped(SceneTimeKey);
    if (!clock) throw new Error("Expected the engine to register a SceneTime");

    const raw = new QueryReader(() => input.isJustHeldFor("charge", 0.05));
    const scene = new QueryReader(() =>
      input.isJustHeldFor("charge", 0.05, { clock }),
    );
    scheduler.add(raw);
    scheduler.add(scene);

    // The freeze ages on real time, so the raw clock reaches the threshold
    // during it and the scene clock only starts counting once it lifts.
    clock.freezeFor(0.1);
    input.fireActionDown("charge");
    for (let i = 0; i < 15; i++) engine.loop.tick(16);

    expect(raw.readings.filter(Boolean).length).toBe(1);
    expect(scene.readings.filter(Boolean).length).toBe(1);
    expect(scene.readings.indexOf(true)).toBeGreaterThan(
      raw.readings.indexOf(true),
    );
    engine.destroy();
  });
});
