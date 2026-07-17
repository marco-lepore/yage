import { describe, it, expect } from "vitest";
import { SceneTime, SceneTimeKey } from "./SceneTime.js";
import { Scene } from "./Scene.js";
import { Component } from "./Component.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { Process } from "./Process.js";
import { ProcessSystem } from "./ProcessSystem.js";
import { SceneManagerKey } from "./EngineContext.js";
import type { SceneManager } from "./SceneManager.js";
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
      const { time } = createSceneTime();
      const a = time.scaleBy(0.5, { key: "a" });
      const b = time.freezeFor(1, { key: "b" });
      time._releaseAll();
      expect(a.active).toBe(false);
      expect(b.active).toBe(false);
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
  });

  describe("labels", () => {
    it("defaults labels to the key, then 'anonymous'", () => {
      const { time } = createSceneTime();
      time.scaleBy(0.5, { key: "slowmo" });
      time.freezeFor(1, { label: "hitstop" });
      time.scaleBy(0.5);
      expect(time.activeLabels).toEqual(["slowmo", "hitstop", "anonymous"]);
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
});
