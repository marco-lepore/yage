import { describe, it, expect, vi } from "vitest";
import { ProcessSystem, ProcessFixedUpdateSystem } from "./ProcessSystem.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { Process } from "./Process.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import {
  EngineContext,
  SceneManagerKey,
  ErrorBoundaryKey,
  ProcessSystemKey,
} from "./EngineContext.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";
import { Scene } from "./Scene.js";
import { Phase } from "./types.js";
import { advanceFrames, createTestEngine } from "./test-utils.js";

class MockScene {
  name = "TestScene";
  // Set by tests that need ProcessComponent.onAdd() to resolve a real
  // ErrorBoundary — a bare MockScene has no context, matching an entity
  // that was never routed through the engine's scene binding.
  context: EngineContext | undefined;
  private entities = new Set<Entity>();
  timeScale = 1;
  isPaused = false;
  spawn(name: string): Entity {
    const e = new Entity(name);
    e._setScene(this as never, null);
    this.entities.add(e);
    return e;
  }
  getEntities(): ReadonlySet<Entity> {
    return this.entities;
  }
  tryResolveScoped(): undefined {
    return undefined;
  }
  _queueDestroy(): void {}
}

// Minimal SceneManager mock (same pattern as ComponentUpdateSystem.test.ts).
// `scenes` is the backing list so a test can hold more than one active scene;
// `activeScene` is the single-scene shorthand most cases use.
class MockSceneManager {
  scenes: MockScene[] = [];
  get activeScene(): MockScene | undefined {
    return this.scenes[0];
  }
  set activeScene(scene: MockScene | undefined) {
    this.scenes = scene ? [scene] : [];
  }
  get active() {
    return this.activeScene;
  }
  get activeScenes() {
    return this.scenes;
  }
}

describe("ProcessSystem", () => {
  function setup() {
    _resetEntityIdCounter();
    const sceneManager = new MockSceneManager();
    const ctx = new EngineContext();
    ctx.register(SceneManagerKey, sceneManager as never);

    const sys = new ProcessSystem();
    sys._setContext(ctx);
    sys.onRegister?.(ctx);

    return { sys, sceneManager };
  }

  it("has Phase.Update and priority 500", () => {
    const sys = new ProcessSystem();
    expect(sys.phase).toBe(Phase.Update);
    expect(sys.priority).toBe(500);
  });

  it("ticks ProcessComponents on entities in active scene", () => {
    const { sys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const pc = new ProcessComponent();
    entity.add(pc);
    const spy = vi.fn();
    pc.run(new Process({ update: spy }));
    sys.update(16);
    expect(spy).toHaveBeenCalledWith(16, 16);
  });

  it("skips destroyed entities", () => {
    const { sys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const pc = new ProcessComponent();
    entity.add(pc);
    const spy = vi.fn();
    pc.run(new Process({ update: spy }));
    entity.destroy();
    sys.update(16);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips entities without ProcessComponent", () => {
    const { sys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    scene.spawn("no-process");
    expect(() => sys.update(16)).not.toThrow();
  });

  it("does nothing when no active scene", () => {
    const { sys, sceneManager } = setup();
    sceneManager.activeScene = undefined;
    expect(() => sys.update(16)).not.toThrow();
  });

  describe("scene-level processes", () => {
    it("add() and cancel() work independently of entities", () => {
      const { sys } = setup();
      const spy = vi.fn();
      const p = new Process({ update: spy });
      sys.add(p);
      sys.update(16);
      expect(spy).toHaveBeenCalledWith(16, 16);
      sys.cancel();
      expect(p.completed).toBe(true);
    });

    it("scene-level processes are ticked alongside entity processes", () => {
      const { sys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const pc = new ProcessComponent();
      entity.add(pc);
      const entitySpy = vi.fn();
      pc.run(new Process({ update: entitySpy }));
      const sceneSpy = vi.fn();
      sys.add(new Process({ update: sceneSpy }));
      sys.update(16);
      expect(entitySpy).toHaveBeenCalledWith(16, 16);
      expect(sceneSpy).toHaveBeenCalledWith(16, 16);
    });

    it("completed scene-level processes are cleaned up", () => {
      const { sys } = setup();
      const p = new Process({ update: () => true }); // completes immediately
      sys.add(p);
      sys.update(16);
      // Should not throw on second tick (process removed)
      sys.update(16);
      expect(p.completed).toBe(true);
    });

    it("cancel(tag) only cancels matching scene-level processes", () => {
      const { sys } = setup();
      const p1 = new Process({ update: () => {}, tags: ["fade"] });
      const p2 = new Process({ update: () => {}, tags: ["music"] });
      sys.add(p1);
      sys.add(p2);
      sys.cancel("fade");
      expect(p1.completed).toBe(true);
      expect(p2.completed).toBe(false);
    });
  });

  describe("scene-scoped processes (addForScene)", () => {
    it("ticks the process under the scene's timeScale", () => {
      const { sys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 0.5;
      sceneManager.activeScene = scene;
      const spy = vi.fn();
      sys.addForScene(scene as never, new Process({ update: spy }));
      sys.update(20);
      expect(spy).toHaveBeenCalledWith(10, 10);
    });

    it("does NOT tick when the scene is not active (paused)", () => {
      const { sys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const spy = vi.fn();
      sys.addForScene(scene as never, new Process({ update: spy }));
      // Mark scene inactive — sceneManager.activeScenes returns []
      sceneManager.activeScene = undefined;
      sys.update(16);
      expect(spy).not.toHaveBeenCalled();
    });

    it("cancelForScene cancels every scene-bound process", () => {
      const { sys } = setup();
      const scene = new MockScene();
      const p1 = new Process({ update: () => {} });
      const p2 = new Process({ update: () => {} });
      sys.addForScene(scene as never, p1);
      sys.addForScene(scene as never, p2);
      sys.cancelForScene(scene as never);
      expect(p1.completed).toBe(true);
      expect(p2.completed).toBe(true);
    });

    it("cancelForScene with tag filters", () => {
      const { sys } = setup();
      const scene = new MockScene();
      const fade = new Process({ update: () => {}, tags: ["fade"] });
      const sfx = new Process({ update: () => {}, tags: ["sfx"] });
      sys.addForScene(scene as never, fade);
      sys.addForScene(scene as never, sfx);
      sys.cancelForScene(scene as never, "fade");
      expect(fade.completed).toBe(true);
      expect(sfx.completed).toBe(false);
    });

    it("completed scene-bound processes are pruned", () => {
      const { sys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const p = new Process({ update: () => true }); // completes immediately
      sys.addForScene(scene as never, p);
      sys.update(16);
      // Second tick must not throw — process was removed.
      sys.update(16);
      expect(p.completed).toBe(true);
    });

    it("scene-scoped pool is independent of engine-global pool", () => {
      const { sys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const globalSpy = vi.fn();
      const sceneSpy = vi.fn();
      sys.add(new Process({ update: globalSpy }));
      sys.addForScene(scene as never, new Process({ update: sceneSpy }));
      // Pause the scene.
      sceneManager.activeScene = undefined;
      sys.update(16);
      // Global pool keeps ticking; scene pool is gated by activeScenes.
      expect(globalSpy).toHaveBeenCalledWith(16, 16);
      expect(sceneSpy).not.toHaveBeenCalled();
    });
  });

  describe("timeScale", () => {
    it("defaults to 1", () => {
      const sys = new ProcessSystem();
      expect(sys.timeScale).toBe(1);
    });

    it("timeScale = 0.5 halves the dt passed to processes", () => {
      const { sys, sceneManager } = setup();
      sys.timeScale = 0.5;
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const pc = new ProcessComponent();
      entity.add(pc);
      const spy = vi.fn();
      pc.run(new Process({ update: spy }));
      sys.update(16);
      expect(spy).toHaveBeenCalledWith(8, 8);
    });

    it("timeScale = 0 freezes all processes (no progress)", () => {
      const { sys } = setup();
      sys.timeScale = 0;
      const spy = vi.fn();
      sys.add(new Process({ update: spy }));
      sys.update(16);
      // Process still ticked but with dt=0, so elapsed stays 0
      expect(spy).toHaveBeenCalledWith(0, 0);
    });

    it("timeScale = 2 doubles the dt passed to processes", () => {
      const { sys, sceneManager } = setup();
      sys.timeScale = 2;
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const pc = new ProcessComponent();
      entity.add(pc);
      const spy = vi.fn();
      pc.run(new Process({ update: spy }));
      sys.update(16);
      expect(spy).toHaveBeenCalledWith(32, 32);
    });

    it("timeScale applies to scene-level processes too", () => {
      const { sys } = setup();
      sys.timeScale = 0.5;
      const spy = vi.fn();
      sys.add(new Process({ update: spy }));
      sys.update(20);
      expect(spy).toHaveBeenCalledWith(10, 10);
    });
  });

  describe("throwing process callbacks (with an error boundary wired)", () => {
    function setupWithBoundary() {
      _resetEntityIdCounter();
      const sceneManager = new MockSceneManager();
      const ctx = new EngineContext();
      ctx.register(SceneManagerKey, sceneManager as never);
      const logger = new Logger({ level: LogLevel.Debug });
      const boundary = new ErrorBoundary(logger);
      ctx.register(ErrorBoundaryKey, boundary);

      const sys = new ProcessSystem();
      sys._setContext(ctx);
      sys.onRegister?.(ctx);

      return { sys, sceneManager, boundary, ctx };
    }

    it("a throwing global process rethrows, stopping later processes in the same update", () => {
      const { sys, boundary } = setupWithBoundary();
      const throwing = new Process({
        update: () => {
          throw new Error("boom");
        },
      });
      const otherSpy = vi.fn();
      const other = new Process({ update: otherSpy });
      sys.add(throwing);
      sys.add(other);

      expect(() => sys.update(16)).toThrow("boom");

      expect(throwing.completed).toBe(false);
      expect(otherSpy).not.toHaveBeenCalled();
      expect(boundary.getCallbackErrors()).toHaveLength(1);
    });

    it("a global process's async rejection is reported without completing it", async () => {
      const { sys, boundary } = setupWithBoundary();
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      const p = new Process({
        update: (() => Promise.reject(new Error("async boom"))) as unknown as
          // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
          (dt: number, elapsed: number) => boolean | void,
      });
      sys.add(p);

      sys.update(16);
      expect(p.completed).toBe(false); // the rejection hasn't settled yet

      const reason = await rejection;
      expect((reason as Error).message).toBe("async boom");
      expect(p.completed).toBe(false); // never cancelled — resilience is deferred
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        error: "async boom",
      });
    });

    it("a process whose onComplete callback throws still completes, and rethrows", () => {
      const { sys, boundary } = setupWithBoundary();
      const p = new Process({
        update: () => true, // completes immediately
        onComplete: () => {
          throw new Error("onComplete boom");
        },
      });
      sys.add(p);

      expect(() => sys.update(16)).toThrow("onComplete boom");
      expect(p.completed).toBe(true); // Process.complete() flips this before onComplete runs
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        error: "onComplete boom",
      });
    });

    it("scene-pool process errors record the scene name", () => {
      const { sys, sceneManager, boundary } = setupWithBoundary();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      sys.addForScene(
        scene as never,
        new Process({
          update: () => {
            throw new Error("boom");
          },
        }),
      );

      expect(() => sys.update(16)).toThrow("boom");

      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Process callback",
        scene: "TestScene",
      });
    });

    it("a throwing entity-owned process rethrows, stopping other entities' processes for that update", () => {
      const { sys, sceneManager, boundary, ctx } = setupWithBoundary();
      const scene = new MockScene();
      scene.context = ctx;
      sceneManager.activeScene = scene;

      const thrower = scene.spawn("thrower");
      const throwerPc = new ProcessComponent();
      thrower.add(throwerPc);
      throwerPc.run(
        new Process({
          update: () => {
            throw new Error("boom");
          },
        }),
      );

      const ok = scene.spawn("ok");
      const okPc = new ProcessComponent();
      ok.add(okPc);
      const okSpy = vi.fn();
      okPc.run(new Process({ update: okSpy }));

      expect(() => sys.update(16)).toThrow("boom");

      expect(okSpy).not.toHaveBeenCalled();
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Process callback",
        entity: "thrower",
        scene: "TestScene",
      });
    });
  });
});

describe("ProcessFixedUpdateSystem", () => {
  function setup() {
    _resetEntityIdCounter();
    const sceneManager = new MockSceneManager();
    const ctx = new EngineContext();
    ctx.register(SceneManagerKey, sceneManager as never);

    const owner = new ProcessSystem();
    owner._setContext(ctx);
    owner.onRegister?.(ctx);

    const sys = new ProcessFixedUpdateSystem(owner);
    sys._setContext(ctx);
    sys.onRegister?.(ctx);

    return { sys, owner, sceneManager };
  }

  it("has Phase.FixedUpdate and priority 500", () => {
    const sys = new ProcessFixedUpdateSystem(new ProcessSystem());
    expect(sys.phase).toBe(Phase.FixedUpdate);
    expect(sys.priority).toBe(500);
  });

  it("ticks fixed-clock processes and leaves frame-clock ones alone", () => {
    const { sys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const pc = new ProcessComponent();
    entity.add(pc);
    const fixedSpy = vi.fn();
    const frameSpy = vi.fn();
    pc.run(new Process({ update: fixedSpy }), { clock: "fixed" });
    pc.run(new Process({ update: frameSpy }));

    sys.update(0.02);
    expect(fixedSpy).toHaveBeenCalledWith(0.02, 0.02);
    expect(frameSpy).not.toHaveBeenCalled();
  });

  it("the frame pass does not advance fixed-clock processes", () => {
    const { sys, owner, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const pc = new ProcessComponent();
    entity.add(pc);
    const fixedSpy = vi.fn();
    pc.run(new Process({ update: fixedSpy }), { clock: "fixed" });

    owner.update(0.1);
    expect(fixedSpy).not.toHaveBeenCalled();
    sys.update(0.02);
    expect(fixedSpy).toHaveBeenCalledTimes(1);
  });

  it("composes the owner's global timeScale with scene and entity scales", () => {
    const { sys, owner, sceneManager } = setup();
    const scene = new MockScene();
    scene.timeScale = 0.5;
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    entity.timeScale = 2;
    const pc = new ProcessComponent();
    entity.add(pc);
    const spy = vi.fn();
    pc.run(new Process({ update: spy }), { clock: "fixed" });

    owner.timeScale = 0.5;
    sys.update(0.02);
    // 0.02 * 0.5 (global) * 0.5 (scene) * 2 (entity)
    expect(spy).toHaveBeenCalledWith(0.01, 0.01);
  });

  it("skips destroyed entities", () => {
    const { sys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const pc = new ProcessComponent();
    entity.add(pc);
    const spy = vi.fn();
    pc.run(new Process({ update: spy }), { clock: "fixed" });
    entity.destroy();
    sys.update(0.02);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing when no active scene", () => {
    const { sys, sceneManager } = setup();
    sceneManager.activeScene = undefined;
    expect(() => sys.update(0.02)).not.toThrow();
  });

  describe("engine-level fixed pools", () => {
    it("a fixed-clock global process is ticked by the fixed pass and not by the frame pass", () => {
      const { sys, owner } = setup();
      const spy = vi.fn();
      owner.add(new Process({ update: spy }), { clock: "fixed" });

      owner.update(0.1);
      expect(spy).not.toHaveBeenCalled();

      sys.update(0.02);
      expect(spy).toHaveBeenCalledWith(0.02, 0.02);
    });

    it("a frame-clock global process is not ticked by the fixed pass", () => {
      const { sys, owner } = setup();
      const spy = vi.fn();
      owner.add(new Process({ update: spy }));

      sys.update(0.02);
      expect(spy).not.toHaveBeenCalled();

      owner.update(0.1);
      expect(spy).toHaveBeenCalledWith(0.1, 0.1);
    });

    it("a fixed-clock scene process is ticked under the scene's timeScale", () => {
      const { sys, owner, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 0.5;
      sceneManager.activeScene = scene;
      const spy = vi.fn();
      owner.addForScene(scene as never, new Process({ update: spy }), {
        clock: "fixed",
      });

      sys.update(0.02);
      expect(spy).toHaveBeenCalledWith(0.01, 0.01);
    });

    it("a fixed-clock scene process does not tick while its scene is inactive", () => {
      const { sys, owner, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const spy = vi.fn();
      owner.addForScene(scene as never, new Process({ update: spy }), {
        clock: "fixed",
      });

      sceneManager.activeScene = undefined;
      sys.update(0.02);
      expect(spy).not.toHaveBeenCalled();
    });

    it("the fixed global pool drains once per fixed step regardless of how many scenes are active", () => {
      const { sys, owner, sceneManager } = setup();
      sceneManager.scenes = [new MockScene(), new MockScene()];
      const spy = vi.fn();
      owner.add(new Process({ update: spy }), { clock: "fixed" });

      sys.update(0.02);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(0.02, 0.02);
    });

    it("the fixed global pool ignores per-scene time scale", () => {
      const { sys, owner, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 0.5;
      sceneManager.activeScene = scene;
      owner.timeScale = 2;
      const spy = vi.fn();
      owner.add(new Process({ update: spy }), { clock: "fixed" });

      sys.update(0.02);
      expect(spy).toHaveBeenCalledWith(0.04, 0.04);
    });

    it("completed fixed pool processes are pruned", () => {
      const { sys, owner, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const globalP = new Process({ update: () => true });
      const sceneP = new Process({ update: () => true });
      owner.add(globalP, { clock: "fixed" });
      owner.addForScene(scene as never, sceneP, { clock: "fixed" });

      sys.update(0.02);
      expect(globalP.completed).toBe(true);
      expect(sceneP.completed).toBe(true);

      // Second step must not throw and must not re-tick the pruned entries.
      const globalTick = vi.spyOn(globalP, "_update");
      const sceneTick = vi.spyOn(sceneP, "_update");
      expect(() => sys.update(0.02)).not.toThrow();
      expect(globalTick).not.toHaveBeenCalled();
      expect(sceneTick).not.toHaveBeenCalled();
    });

    it("a drained scene pool drops its map entry, releasing the Scene key", () => {
      const { sys, owner, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const maps = owner as unknown as {
        scenePools: Map<unknown, unknown>;
        fixedScenePools: Map<unknown, unknown>;
      };
      owner.addForScene(scene as never, new Process({ update: () => true }), {
        clock: "fixed",
      });
      owner.addForScene(scene as never, new Process({ update: () => true }));
      expect(maps.fixedScenePools.size).toBe(1);
      expect(maps.scenePools.size).toBe(1);

      sys.update(0.02);
      owner.update(0.02);
      expect(maps.fixedScenePools.size).toBe(0);
      expect(maps.scenePools.size).toBe(0);
    });

    it("cancel(tag) reaches fixed-clock global processes", () => {
      const { owner } = setup();
      const taggedFixed = new Process({ update: () => {}, tags: ["fade"] });
      const taggedFrame = new Process({ update: () => {}, tags: ["fade"] });
      const untaggedFixed = new Process({ update: () => {}, tags: ["music"] });
      owner.add(taggedFixed, { clock: "fixed" });
      owner.add(taggedFrame);
      owner.add(untaggedFixed, { clock: "fixed" });

      owner.cancel("fade");
      expect(taggedFixed.completed).toBe(true);
      expect(taggedFrame.completed).toBe(true);
      expect(untaggedFixed.completed).toBe(false);
    });

    it("cancelForScene(scene, tag) reaches fixed-clock scene processes", () => {
      const { owner } = setup();
      const scene = new MockScene();
      const taggedFixed = new Process({ update: () => {}, tags: ["fade"] });
      const taggedFrame = new Process({ update: () => {}, tags: ["fade"] });
      const untaggedFixed = new Process({ update: () => {}, tags: ["music"] });
      owner.addForScene(scene as never, taggedFixed, { clock: "fixed" });
      owner.addForScene(scene as never, taggedFrame);
      owner.addForScene(scene as never, untaggedFixed, { clock: "fixed" });

      owner.cancelForScene(scene as never, "fade");
      expect(taggedFixed.completed).toBe(true);
      expect(taggedFrame.completed).toBe(true);
      expect(untaggedFixed.completed).toBe(false);
    });

    it("cancelForScene with no tag empties both scene maps", () => {
      const { sys, owner, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const maps = owner as unknown as {
        scenePools: Map<unknown, unknown>;
        fixedScenePools: Map<unknown, unknown>;
      };
      const fixedSpy = vi.fn();
      const frameSpy = vi.fn();
      owner.addForScene(scene as never, new Process({ update: fixedSpy }), {
        clock: "fixed",
      });
      owner.addForScene(scene as never, new Process({ update: frameSpy }));

      owner.cancelForScene(scene as never);
      sys.update(0.02);
      owner.update(0.1);
      expect(fixedSpy).not.toHaveBeenCalled();
      expect(frameSpy).not.toHaveBeenCalled();
      // The emptied map entries go too, so the Scene key is not held.
      expect(maps.fixedScenePools.size).toBe(0);
      expect(maps.scenePools.size).toBe(0);
    });

    it("onUnregister cancels processes in all four pools", () => {
      const { owner } = setup();
      const scene = new MockScene();
      const frameGlobal = new Process({ update: () => {} });
      const fixedGlobal = new Process({ update: () => {} });
      const frameScene = new Process({ update: () => {} });
      const fixedScene = new Process({ update: () => {} });
      owner.add(frameGlobal);
      owner.add(fixedGlobal, { clock: "fixed" });
      owner.addForScene(scene as never, frameScene);
      owner.addForScene(scene as never, fixedScene, { clock: "fixed" });

      owner.onUnregister?.();
      expect(frameGlobal.completed).toBe(true);
      expect(fixedGlobal.completed).toBe(true);
      expect(frameScene.completed).toBe(true);
      expect(fixedScene.completed).toBe(true);
    });
  });

  describe("error attribution on the fixed pools", () => {
    function setupWithBoundary() {
      _resetEntityIdCounter();
      const sceneManager = new MockSceneManager();
      const ctx = new EngineContext();
      ctx.register(SceneManagerKey, sceneManager as never);
      const logger = new Logger({ level: LogLevel.Debug });
      const boundary = new ErrorBoundary(logger);
      ctx.register(ErrorBoundaryKey, boundary);

      const owner = new ProcessSystem();
      owner._setContext(ctx);
      owner.onRegister?.(ctx);

      const sys = new ProcessFixedUpdateSystem(owner);
      sys._setContext(ctx);
      sys.onRegister?.(ctx);

      return { sys, owner, sceneManager, boundary };
    }

    it("a throwing fixed scene-pool process is attributed to its scene", () => {
      const { sys, owner, sceneManager, boundary } = setupWithBoundary();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      owner.addForScene(
        scene as never,
        new Process({
          update: () => {
            throw new Error("boom");
          },
        }),
        { clock: "fixed" },
      );

      expect(() => sys.update(0.02)).toThrow("boom");
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Process callback",
        scene: "TestScene",
      });
    });

    it("a throwing fixed global-pool process is attributed with no scene", () => {
      const { sys, owner, boundary } = setupWithBoundary();
      owner.add(
        new Process({
          update: () => {
            throw new Error("boom");
          },
        }),
        { clock: "fixed" },
      );

      expect(() => sys.update(0.02)).toThrow("boom");
      const errors = boundary.getCallbackErrors();
      expect(errors[0]).toMatchObject({ kind: "Process callback" });
      expect(errors[0]).not.toHaveProperty("scene");
    });
  });

  it("the engine-registered fixed system drains a scene's fixed pool", async () => {
    class TimerScene extends Scene {
      readonly name = "timers";
    }
    const engine = await createTestEngine();
    const scene = new TimerScene();
    await engine.scenes.push(scene);
    const processSystem = engine.context.resolve(ProcessSystemKey);

    const fired = vi.fn();
    processSystem.addForScene(scene, Process.delay(0.1, fired), {
      clock: "fixed",
    });

    // One 1s frame runs the loop's five-step cap: 5 x 1/60 = 0.083s of fixed
    // time, short of the 0.1s delay. The frame pass would have advanced the
    // whole second in one go, so a frame-pool process would already have
    // fired here. That is what separates the two clocks.
    advanceFrames(engine, 1, 1000);
    expect(fired).not.toHaveBeenCalled();

    // Five more fixed steps take the total past 0.1s.
    advanceFrames(engine, 1, 1000);
    expect(fired).toHaveBeenCalledOnce();
    engine.destroy();
  });
});
