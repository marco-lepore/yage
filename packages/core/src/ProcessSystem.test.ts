import { describe, it, expect, vi } from "vitest";
import { ProcessSystem } from "./ProcessSystem.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { Process } from "./Process.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { EngineContext, SceneManagerKey } from "./EngineContext.js";
import { Phase } from "./types.js";

class MockScene {
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
  _queueDestroy(): void {}
}

// Minimal SceneManager mock (same pattern as ComponentUpdateSystem.test.ts)
class MockSceneManager {
  activeScene: MockScene | undefined;
  get active() {
    return this.activeScene;
  }
  get activeScenes() {
    return this.activeScene ? [this.activeScene] : [];
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
});
