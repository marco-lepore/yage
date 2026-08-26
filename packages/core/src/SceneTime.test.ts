import { describe, it, expect } from "vitest";
import { SceneTime, SceneTimeKey } from "./SceneTime.js";
import { Scene } from "./Scene.js";
import { Component } from "./Component.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { Process } from "./Process.js";
import { ProcessSystem, ProcessFixedUpdateSystem } from "./ProcessSystem.js";
import { SceneManagerKey, SystemSchedulerKey } from "./EngineContext.js";
import type { SceneManager } from "./SceneManager.js";
import { System } from "./System.js";
import { Phase } from "./types.js";
import {
  createMockScene,
  createTestEngine,
  advanceFrames,
} from "./test-utils.js";

function createSceneTime() {
  const { scene, context } = createMockScene();
  // A dedicated instance (independent of the one createMockScene registers)
  // so unit tests own the tick cadence.
  const time = new SceneTime(scene);
  return { scene, context, time };
}

class UpdatingComponent extends Component {
  calls: number[] = [];
  update(dt: number) {
    this.calls.push(dt);
  }
}

/** Samples `fixedElapsed` once per fixed step, in physics' priority slot. */
class FixedElapsedReader extends System {
  readonly phase = Phase.FixedUpdate;
  readings: number[] = [];

  constructor(private readonly time: SceneTime) {
    super();
  }

  update(): void {
    this.readings.push(this.time.fixedElapsed);
  }
}

describe("SceneTime", () => {
  describe("composition", () => {
    it("defaults to scene.timeScale with no requests", () => {
      const { scene, time } = createSceneTime();
      expect(time.effectiveScale).toBe(1);
      scene.timeScale = 0.5;
      expect(time.effectiveScale).toBe(0.5);
      expect(time.isFrozen).toBe(false);
    });

    it("multiplies winners across channels", () => {
      const { time } = createSceneTime();
      time.scaleBy(0.5, { key: "a" });
      time.scaleBy(0.5, { key: "b" });
      expect(time.effectiveScale).toBe(0.25);
    });

    it("treats each unkeyed call as its own channel", () => {
      const { time } = createSceneTime();
      time.scaleBy(0.5);
      time.scaleBy(0.5);
      expect(time.effectiveScale).toBe(0.25);
    });

    it("latest active request wins within a channel", () => {
      const { time } = createSceneTime();
      time.scaleBy(0.25, { key: "slow" });
      time.scaleBy(0.4, { key: "slow" });
      expect(time.effectiveScale).toBe(0.4);
    });

    it("composes with scene.timeScale live", () => {
      const { scene, time } = createSceneTime();
      time.scaleBy(0.5, { key: "a" });
      scene.timeScale = 2;
      expect(time.effectiveScale).toBe(1);
    });

    it("supports speed-up factors above 1", () => {
      const { time } = createSceneTime();
      time.scaleBy(2, { key: "haste" });
      expect(time.effectiveScale).toBe(2);
    });

    it("freeze is a multiplicative zero across channels", () => {
      const { time } = createSceneTime();
      time.scaleBy(2, { key: "haste" });
      time.freezeFor(1, { key: "hitstop" });
      expect(time.effectiveScale).toBe(0);
      expect(time.isFrozen).toBe(true);
    });

    it("a newer slow masks a freeze in the same channel", () => {
      const { time } = createSceneTime();
      time.freezeFor(1, { key: "k" });
      time.scaleBy(0.4, { key: "k" });
      expect(time.effectiveScale).toBe(0.4);
      expect(time.isFrozen).toBe(false);
    });

    it("stays frozen until both freeze channels end", () => {
      const { time } = createSceneTime();
      time.freezeFor(0.1, { key: "a" });
      time.freezeFor(0.3, { key: "b" });
      time._tick(0.2);
      expect(time.isFrozen).toBe(true);
      time._tick(0.2);
      expect(time.isFrozen).toBe(false);
      expect(time.effectiveScale).toBe(1);
    });
  });

  describe("elapsed", () => {
    it("accrues under a plain scene.timeScale", () => {
      const { scene, time } = createSceneTime();
      scene.timeScale = 0.5;

      time._tick(0.4);

      expect(time.elapsed).toBeCloseTo(0.2);
    });

    it("accrues under an active scaleBy request", () => {
      const { time } = createSceneTime();
      time.scaleBy(0.25);

      time._tick(0.4);

      expect(time.elapsed).toBeCloseTo(0.1);
    });

    it("stays at 0 during an active freezeFor request", () => {
      const { time } = createSceneTime();
      time.freezeFor(1);

      time._tick(0.4);

      expect(time.elapsed).toBe(0);
    });

    it("uses the scale recomputed after request timers age", () => {
      const { time } = createSceneTime();
      time.scaleBy(0.25, { for: 0.1 });

      time._tick(0.1);

      expect(time.elapsed).toBeCloseTo(0.1);
    });
  });

  describe("fixedElapsed", () => {
    it("accrues one scaled step per call", () => {
      const { scene, time } = createSceneTime();
      scene.timeScale = 0.5;

      time._tickFixed(0.02);
      time._tickFixed(0.02);

      expect(time.fixedElapsed).toBeCloseTo(0.02);
    });

    it("is independent of the frame accrual", () => {
      const { time } = createSceneTime();

      time._tick(0.4);
      expect(time.fixedElapsed).toBe(0);
      expect(time.elapsed).toBeCloseTo(0.4);

      time._tickFixed(0.016);
      expect(time.elapsed).toBeCloseTo(0.4);
      expect(time.fixedElapsed).toBeCloseTo(0.016);
    });

    it("stays at 0 during an active freezeFor request", () => {
      const { time } = createSceneTime();
      time.freezeFor(1);

      time._tickFixed(0.016);

      expect(time.fixedElapsed).toBe(0);
    });

    it("does not age request timers", () => {
      const { time } = createSceneTime();
      time.scaleBy(0.5, { for: 0.05 });

      for (let i = 0; i < 5; i++) time._tickFixed(0.016);

      // Only _tick ages a request, so 0.08s of fixed steps leave the 0.05s
      // request in force.
      expect(time.effectiveScale).toBe(0.5);
      expect(time.fixedElapsed).toBeCloseTo(0.04);
    });
  });

  describe("show-through and timers", () => {
    it("reveals the older still-active request when the newer expires", () => {
      // 0.25 for 1s; 0.4 for 0.5s starting at t=0.25 (binary-exact durations).
      const { time } = createSceneTime();
      time.scaleBy(0.25, { for: 1, key: "slow" });
      expect(time.effectiveScale).toBe(0.25);
      time._tick(0.25);
      time.scaleBy(0.4, { for: 0.5, key: "slow" });
      expect(time.effectiveScale).toBe(0.4);
      time._tick(0.5); // newer expires; masked entry kept aging (0.75 → 0.25)
      expect(time.effectiveScale).toBe(0.25);
      time._tick(0.25); // older expires
      expect(time.effectiveScale).toBe(1);
    });

    it("releasing a masked entry changes nothing", () => {
      const { time } = createSceneTime();
      const older = time.scaleBy(0.25, { key: "slow" });
      time.scaleBy(0.4, { key: "slow" });
      older.release();
      expect(time.effectiveScale).toBe(0.4);
    });

    it("returns an inactive no-entry handle for duration 0", () => {
      const { time } = createSceneTime();
      const scaled = time.scaleBy(0.5, { for: 0 });
      const frozen = time.freezeFor(0);
      expect(scaled.active).toBe(false);
      expect(frozen.active).toBe(false);
      expect(time.effectiveScale).toBe(1);
      scaled.release(); // no-op
      expect(time.effectiveScale).toBe(1);
    });

    it("handle.active stays true while masked, false after expiry", () => {
      const { time } = createSceneTime();
      const older = time.scaleBy(0.25, { for: 1, key: "slow" });
      time.scaleBy(0.4, { key: "slow" });
      expect(older.active).toBe(true);
      time._tick(1);
      expect(older.active).toBe(false);
    });

    it("release is idempotent", () => {
      const { time } = createSceneTime();
      const handle = time.scaleBy(0.5, { key: "a" });
      handle.release();
      handle.release();
      expect(handle.active).toBe(false);
      expect(time.effectiveScale).toBe(1);
    });

    it("_releaseAll releases everything", () => {
      const { scene, time } = createSceneTime();
      const a = time.scaleBy(0.5, { key: "a" });
      const b = time.freezeFor(1, { key: "b" });
      const c = time.freezeEntityFor(scene.spawn("target"), 1);
      time._releaseAll();
      expect(a.active).toBe(false);
      expect(b.active).toBe(false);
      expect(c.active).toBe(false);
      expect(time.effectiveScale).toBe(1);
    });
  });

  describe("validation", () => {
    it("rejects non-positive and non-finite factors", () => {
      const { time } = createSceneTime();
      expect(() => time.scaleBy(0)).toThrow(/finite and > 0/);
      expect(() => time.scaleBy(-1)).toThrow(/finite and > 0/);
      expect(() => time.scaleBy(Number.NaN)).toThrow(/finite and > 0/);
      expect(() => time.scaleBy(Infinity)).toThrow(/finite and > 0/);
    });

    it("rejects invalid durations", () => {
      const { time } = createSceneTime();
      expect(() => time.scaleBy(0.5, { for: -1 })).toThrow(/finite/);
      expect(() => time.scaleBy(0.5, { for: Number.NaN })).toThrow(/finite/);
      expect(() => time.freezeFor(-1)).toThrow(/finite/);
      expect(() => time.freezeFor(Infinity)).toThrow(/finite/);
    });
  });

  describe("excludeUpdates", () => {
    it("skips excluding channels for the excluded entity only", () => {
      const { scene, time } = createSceneTime();
      const excluded = scene.spawn("excluded");
      const other = scene.spawn("other");
      time.scaleBy(0.25, { key: "a", excludeUpdates: [excluded] });
      time.scaleBy(0.5, { key: "b" });
      expect(time.effectiveScale).toBe(0.125);
      expect(time.effectiveScaleForUpdates(excluded)).toBe(0.5);
      expect(time.effectiveScaleForUpdates(other)).toBe(0.125);
    });

    it("only the channel winner's exclusions are in force", () => {
      const { scene, time } = createSceneTime();
      const entity = scene.spawn("e");
      time.scaleBy(0.25, { key: "a", excludeUpdates: [entity] });
      time.scaleBy(0.5, { key: "a" }); // new winner, no exclusions
      expect(time.effectiveScaleForUpdates(entity)).toBe(0.5);
    });

    it("composes with scene.timeScale but not entity.timeScale", () => {
      const { scene, time } = createSceneTime();
      const entity = scene.spawn("e");
      entity.timeScale = 4;
      scene.timeScale = 0.5;
      time.scaleBy(0.25, { key: "a", excludeUpdates: [entity] });
      // entity.timeScale is composed by the pipeline, not the service.
      expect(time.effectiveScaleForUpdates(entity)).toBe(0.5);
    });

    it("prunes destroyed entities from exclusion sets on tick", () => {
      const { scene, time } = createSceneTime();
      const entity = scene.spawn("e");
      time.scaleBy(0.25, { key: "a", excludeUpdates: [entity] });
      expect(time.effectiveScaleForUpdates(entity)).toBe(1);
      entity.destroy();
      scene._flushDestroyQueue();
      time._tick(0.016);
      expect(time.effectiveScaleForUpdates(entity)).toBe(0.25);
    });

    it("lets excluded entity updates continue during a scene freeze", () => {
      const { scene, time } = createSceneTime();
      const excluded = scene.spawn("excluded");
      const other = scene.spawn("other");

      time.freezeFor(1, { excludeUpdates: [excluded] });

      expect(time.effectiveScale).toBe(0);
      expect(time.effectiveScaleForUpdates(excluded)).toBe(1);
      expect(time.effectiveScaleForUpdates(other)).toBe(0);
    });
  });

  describe("entity requests", () => {
    it("scales only the target and composes target channels", () => {
      const { scene, time } = createSceneTime();
      const target = scene.spawn("target");
      const other = scene.spawn("other");

      time.scaleEntityBy(target, 0.5, { key: "slow" });
      time.scaleEntityBy(target, 0.5, { key: "status" });

      expect(time.effectiveScale).toBe(1);
      expect(time.effectiveScaleForUpdates(target)).toBe(0.25);
      expect(time.effectiveScaleForUpdates(other)).toBe(1);
    });

    it("uses latest-request-wins channels per target", () => {
      const { scene, time } = createSceneTime();
      const target = scene.spawn("target");
      const older = time.scaleEntityBy(target, 0.25, { key: "slow" });
      const newer = time.scaleEntityBy(target, 0.5, { key: "slow" });

      expect(time.effectiveScaleForUpdates(target)).toBe(0.5);
      newer.release();
      expect(time.effectiveScaleForUpdates(target)).toBe(0.25);
      older.release();
      expect(time.effectiveScaleForUpdates(target)).toBe(1);
    });

    it("freezes one target without freezing the scene", () => {
      const { scene, time } = createSceneTime();
      const target = scene.spawn("target");
      const other = scene.spawn("other");

      time.freezeEntityFor(target, 1);

      expect(time.isFrozen).toBe(false);
      expect(time.effectiveScaleForUpdates(target)).toBe(0);
      expect(time.effectiveScaleForUpdates(other)).toBe(1);
    });

    it("ages target requests on raw time", () => {
      const { scene, time } = createSceneTime();
      const target = scene.spawn("target");
      const handle = time.freezeEntityFor(target, 0.1);

      time._tick(0.1);

      expect(handle.active).toBe(false);
      expect(time.effectiveScaleForUpdates(target)).toBe(1);
    });

    it("releases requests when the target is destroyed", () => {
      const { scene, time } = createSceneTime();
      const target = scene.spawn("target");
      const handle = time.scaleEntityBy(target, 0.5);

      target.destroy();
      scene._flushDestroyQueue();
      time._tick(0.016);

      expect(handle.active).toBe(false);
    });

    it("rejects targets from another scene", () => {
      const { time } = createSceneTime();
      const { scene: otherScene } = createSceneTime();
      const target = otherScene.spawn("target");

      expect(() => time.scaleEntityBy(target, 0.5)).toThrow(/owning scene/);
      expect(() => time.freezeEntityFor(target, 0.1)).toThrow(/owning scene/);
    });

    it("validates factors and durations", () => {
      const { scene, time } = createSceneTime();
      const target = scene.spawn("target");

      expect(() => time.scaleEntityBy(target, 0)).toThrow(/finite and > 0/);
      expect(() => time.scaleEntityBy(target, 0.5, { for: -1 })).toThrow(
        /finite duration/,
      );
      expect(() => time.freezeEntityFor(target, -1)).toThrow(/finite duration/);
    });
  });

  describe("labels", () => {
    it("defaults labels to the key, then 'anonymous'", () => {
      const { scene, time } = createSceneTime();
      time.scaleBy(0.5, { key: "slowmo" });
      time.freezeFor(1, { label: "hitstop" });
      time.scaleBy(0.5);
      time.freezeEntityFor(scene.spawn("target"), 1, { label: "stagger" });
      expect(time.activeLabels).toEqual([
        "slowmo",
        "hitstop",
        "anonymous",
        "stagger",
      ]);
    });
  });
});

describe("SceneTime engine integration", () => {
  class GameScene extends Scene {
    readonly name = "game";
  }
  class OverlayScene extends Scene {
    readonly name = "overlay";
  }

  it("registers a SceneTime per scene and releases requests on exit", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey);
    expect(time).toBeInstanceOf(SceneTime);

    const handle = time!.scaleBy(0.5, { key: "slowmo" });
    await engine.scenes.pop();
    expect(handle.active).toBe(false);
    engine.destroy();
  });

  it("freezes component updates and expires on raw frame time", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const comp = new UpdatingComponent();
    scene.spawn("e").add(comp);

    const time = scene.tryResolveScoped(SceneTimeKey)!;
    time.freezeFor(0.15);
    advanceFrames(engine, 1, 100); // aged 0.1 → still frozen this frame
    advanceFrames(engine, 1, 100); // expires at the frame's timer pass
    expect(comp.calls).toEqual([0, 0.1]);
    engine.destroy();
  });

  it("freezes one entity's updates and expires without that entity ticking", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const frozenComp = new UpdatingComponent();
    const runningComp = new UpdatingComponent();
    const frozen = scene.spawn("frozen");
    frozen.add(frozenComp);
    scene.spawn("running").add(runningComp);

    const time = scene.tryResolveScoped(SceneTimeKey)!;
    time.freezeEntityFor(frozen, 0.15);
    advanceFrames(engine, 1, 100);
    advanceFrames(engine, 1, 100);

    expect(frozenComp.calls).toEqual([0, 0.1]);
    expect(runningComp.calls).toEqual([0.1, 0.1]);
    engine.destroy();
  });

  it("scales excluded and non-excluded entities differently end-to-end", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const excludedComp = new UpdatingComponent();
    const otherComp = new UpdatingComponent();
    const excluded = scene.spawn("excluded");
    excluded.add(excludedComp);
    scene.spawn("other").add(otherComp);

    const time = scene.tryResolveScoped(SceneTimeKey)!;
    const handle = time.scaleBy(0.5, {
      key: "slowmo",
      excludeUpdates: [excluded],
    });
    excluded.timeScale = 2; // composes on top of the excluded scale
    advanceFrames(engine, 1, 100);
    handle.release();
    advanceFrames(engine, 1, 100);

    expect(excludedComp.calls).toEqual([0.2, 0.2]);
    expect(otherComp.calls[0]).toBeCloseTo(0.05);
    expect(otherComp.calls[1]).toBeCloseTo(0.1);
    engine.destroy();
  });

  it("holds request timers while the scene is stack-paused", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const comp = new UpdatingComponent();
    scene.spawn("e").add(comp);

    const time = scene.tryResolveScoped(SceneTimeKey)!;
    time.freezeFor(0.15);
    await engine.scenes.push(new OverlayScene()); // pauseBelow: game holds
    advanceFrames(engine, 5, 100); // 0.5s of pause-menu time
    await engine.scenes.pop();

    advanceFrames(engine, 1, 100); // aged 0.1 → still frozen
    advanceFrames(engine, 1, 100); // expires
    expect(comp.calls).toEqual([0, 0.1]);
    engine.destroy();
  });

  it("accrues fixedElapsed once per fixed step, not once per frame", async () => {
    // 16ms fixed step so tick(8/16/32) gives exact zero/one/two-step frames.
    const engine = await createTestEngine({ fixedTimestep: 0.016 });
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;

    engine.loop.tick(8); // accumulator below the step: no step runs
    expect(time.fixedElapsed).toBe(0);
    expect(time.elapsed).toBeCloseTo(0.008);

    engine.loop.tick(8); // accumulator reaches 16ms: exactly one step
    expect(time.fixedElapsed).toBeCloseTo(0.016);

    engine.loop.tick(32); // two steps
    expect(time.fixedElapsed).toBeCloseTo(0.048);
    expect(time.elapsed).toBeCloseTo(0.048);
    engine.destroy();
  });

  it("reports the step a fixed-phase system is inside", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.016 });
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;
    const reader = new FixedElapsedReader(time);
    engine.context.resolve(SystemSchedulerKey).add(reader);

    engine.loop.tick(32); // two fixed steps

    // The accrual runs before the phase, so a reader at priority 0 — physics'
    // slot — sees the step it is inside already counted.
    expect(reader.readings).toHaveLength(2);
    expect(reader.readings[0]).toBeCloseTo(0.016);
    expect(reader.readings[1]).toBeCloseTo(0.032);
    engine.destroy();
  });

  it("holds fixedElapsed while the scene is stack-paused", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.016 });
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;

    advanceFrames(engine, 2, 16); // one step per frame
    const beforePause = time.fixedElapsed;
    expect(beforePause).toBeCloseTo(0.032);

    await engine.scenes.push(new OverlayScene()); // pauseBelow: game holds
    advanceFrames(engine, 5, 100);
    expect(time.fixedElapsed).toBe(beforePause);

    await engine.scenes.pop();
    advanceFrames(engine, 1, 16);
    expect(time.fixedElapsed).toBeGreaterThan(beforePause);
    engine.destroy();
  });

  it("scales fixedElapsed with an active request end to end", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.016 });
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;
    time.scaleBy(0.5, { key: "slowmo" });

    engine.loop.tick(16); // exactly one fixed step

    expect(time.fixedElapsed).toBeCloseTo(0.008);
    engine.destroy();
  });

  it("falls behind on a clamped frame and catches up over the next ones", async () => {
    const engine = await createTestEngine({
      fixedTimestep: 0.016,
      maxFixedStepsPerFrame: 2,
    });
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;

    engine.loop.tick(100); // 100ms of frame time, capped at two steps
    expect(time.fixedElapsed).toBeCloseTo(0.032);
    expect(time.elapsed - time.fixedElapsed).toBeGreaterThan(0.016);

    // The unspent time stays in the loop's accumulator, so a following 16ms
    // frame still runs two steps: the reading advances faster than the frame.
    const beforeCatchUp = time.fixedElapsed;
    advanceFrames(engine, 1, 16);
    expect(time.fixedElapsed - beforeCatchUp).toBeCloseTo(0.032);

    // This scene ran from the first tick at a constant scale, so the gap is
    // the accumulator remainder: non-negative and under one step.
    advanceFrames(engine, 3, 16);
    const gap = time.elapsed - time.fixedElapsed;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(0.016);
    engine.destroy();
  });

  it("leads elapsed in a scene entered mid-run", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.016 });
    await engine.scenes.push(new GameScene());
    engine.loop.tick(15); // under one step: 15ms stays in the accumulator

    // The accumulator is engine-wide, so the scene starts counting against
    // time that was never its own frame time.
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;

    engine.loop.tick(20); // 15 + 20 = two steps against one 20ms frame
    expect(time.elapsed).toBeCloseTo(0.02);
    expect(time.fixedElapsed).toBeCloseTo(0.032);
    engine.destroy();
  });

  it("leads elapsed when the scale changes before the pending steps run", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.016 });
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;

    const slow = time.scaleBy(0.25, { key: "slowmo" });
    engine.loop.tick(200); // clamps at 5 steps, 0.12s left in the accumulator
    expect(time.elapsed).toBeCloseTo(0.05);
    expect(time.fixedElapsed).toBeCloseTo(0.02);

    // The seconds still in the accumulator convert at the scale in force when
    // their step runs, not the 0.25 of the frame they arrived in.
    slow.release();
    engine.loop.tick(16);
    expect(time.fixedElapsed - time.elapsed).toBeCloseTo(0.034);

    advanceFrames(engine, 60, 16);
    expect(time.fixedElapsed - time.elapsed).toBeGreaterThan(0.034);
    engine.destroy();
  });

  it("reports effectiveTimeScale and frozen through the Inspector", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const time = scene.tryResolveScoped(SceneTimeKey)!;
    time.freezeFor(1);

    const snapshot = engine.inspector.snapshot().scenes[0]!;
    expect(snapshot.timeScale).toBe(1);
    expect(snapshot.effectiveTimeScale).toBe(0);
    expect(snapshot.frozen).toBe(true);
    engine.destroy();
  });

  it("scales the ProcessSystem scene pool at the full effective scale", () => {
    const { scene, context } = createMockScene();
    const sceneManager = {
      activeScenes: [scene],
    } as unknown as SceneManager;
    context.register(SceneManagerKey, sceneManager);
    const system = new ProcessSystem();
    system.onRegister(context);

    const time = scene.tryResolveScoped(SceneTimeKey)!;
    const entity = scene.spawn("e");
    const pc = entity.add(new ProcessComponent());
    const poolDts: number[] = [];
    const entityDts: number[] = [];
    system.addForScene(
      scene,
      new Process({ update: (dt) => void poolDts.push(dt) }),
    );
    pc.run(new Process({ update: (dt) => void entityDts.push(dt) }));

    time.scaleBy(0.5, { key: "slowmo", excludeUpdates: [entity] });
    system.update(0.1);

    // Pool has no owning entity → full effective scale; the excluded
    // entity's ProcessComponent runs unscaled.
    expect(poolDts).toEqual([0.05]);
    expect(entityDts).toEqual([0.1]);
  });

  it("scales the ProcessSystem fixed scene pool at the full effective scale", () => {
    const { scene, context } = createMockScene();
    const sceneManager = {
      activeScenes: [scene],
    } as unknown as SceneManager;
    context.register(SceneManagerKey, sceneManager);
    const system = new ProcessSystem();
    system.onRegister(context);
    const fixedSystem = new ProcessFixedUpdateSystem(system);
    fixedSystem.onRegister(context);

    const time = scene.tryResolveScoped(SceneTimeKey)!;
    const entity = scene.spawn("e");
    const pc = entity.add(new ProcessComponent());
    const poolDts: number[] = [];
    const entityDts: number[] = [];
    system.addForScene(
      scene,
      new Process({ update: (dt) => void poolDts.push(dt) }),
      { clock: "fixed" },
    );
    pc.run(new Process({ update: (dt) => void entityDts.push(dt) }), {
      clock: "fixed",
    });

    time.scaleBy(0.5, { key: "slowmo", excludeUpdates: [entity] });
    fixedSystem.update(0.02);

    // The fixed pass reads the same two scales as the frame pass: the pool
    // takes the scene's effective scale, the excluded entity runs unscaled.
    expect(poolDts).toEqual([0.01]);
    expect(entityDts).toEqual([0.02]);
  });
});
