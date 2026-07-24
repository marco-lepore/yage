import { describe, it, expect } from "vitest";
import {
  ComponentUpdateSystem,
  ComponentFixedUpdateSystem,
} from "./ComponentUpdateSystem.js";
import { Component } from "./Component.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import type { ErrorPolicy } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";
import { GameLoop } from "./GameLoop.js";
import { EngineContext, SceneManagerKey, ErrorBoundaryKey } from "./EngineContext.js";
import { Phase } from "./types.js";

// Minimal SceneManager mock
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
  tryResolveScoped(): undefined {
    return undefined;
  }
  _queueDestroy(): void {}
}

class MockSceneManager {
  activeScene: MockScene | undefined;
  get active() {
    return this.activeScene;
  }
  get activeScenes() {
    return this.activeScene ? [this.activeScene] : [];
  }
}

class UpdatingComponent extends Component {
  calls: number[] = [];
  update(dt: number) {
    this.calls.push(dt);
  }
}

class FixedUpdatingComponent extends Component {
  calls: number[] = [];
  fixedUpdate(dt: number) {
    this.calls.push(dt);
  }
}

class CrashingComponent extends Component {
  update() {
    throw new Error("crash!");
  }
}

class PlainComponent extends Component {}

describe("ComponentUpdateSystem", () => {
  function setup(policy: ErrorPolicy = "isolate") {
    _resetEntityIdCounter();
    const logger = new Logger({ level: LogLevel.Debug });
    const loop = new GameLoop();
    const boundary = new ErrorBoundary(logger, policy, loop);
    const sceneManager = new MockSceneManager();
    const ctx = new EngineContext();
    ctx.register(SceneManagerKey, sceneManager as never);
    ctx.register(ErrorBoundaryKey, boundary);

    const updateSys = new ComponentUpdateSystem();
    updateSys._setContext(ctx);
    updateSys.onRegister?.(ctx);

    const fixedSys = new ComponentFixedUpdateSystem();
    fixedSys._setContext(ctx);
    fixedSys.onRegister?.(ctx);

    return { updateSys, fixedSys, sceneManager, boundary, logger, loop };
  }

  it("has correct phases", () => {
    expect(new ComponentUpdateSystem().phase).toBe(Phase.Update);
    expect(new ComponentFixedUpdateSystem().phase).toBe(Phase.FixedUpdate);
  });

  it("has priority 1000", () => {
    expect(new ComponentUpdateSystem().priority).toBe(1000);
    expect(new ComponentFixedUpdateSystem().priority).toBe(1000);
  });

  it("calls update(dt) on enabled components", () => {
    const { updateSys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const comp = new UpdatingComponent();
    entity.add(comp);
    updateSys.update(16);
    expect(comp.calls).toEqual([16]);
  });

  it("calls fixedUpdate(dt) on enabled components", () => {
    const { fixedSys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const comp = new FixedUpdatingComponent();
    entity.add(comp);
    fixedSys.update(8);
    expect(comp.calls).toEqual([8]);
  });

  it("skips disabled components", () => {
    const { updateSys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const comp = new UpdatingComponent();
    comp.enabled = false;
    entity.add(comp);
    updateSys.update(16);
    expect(comp.calls).toEqual([]);
  });

  it("skips components without update method", () => {
    const { updateSys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    entity.add(new PlainComponent());
    expect(() => updateSys.update(16)).not.toThrow();
  });

  it("skips destroyed entities", () => {
    const { updateSys, sceneManager } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const comp = new UpdatingComponent();
    entity.add(comp);
    entity.destroy();
    updateSys.update(16);
    expect(comp.calls).toEqual([]);
  });

  it("does nothing when no active scene", () => {
    const { updateSys, sceneManager } = setup();
    sceneManager.activeScene = undefined;
    expect(() => updateSys.update(16)).not.toThrow();
  });

  it("disables crashing component via ErrorBoundary", () => {
    const { updateSys, sceneManager, boundary } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const comp = new CrashingComponent();
    entity.add(comp);
    updateSys.update(16);
    expect(comp.enabled).toBe(false);
    const disabled = boundary.getDisabled();
    expect(disabled.components).toHaveLength(1);
  });

  it("under errors: \"fatal\", rethrows and stops the loop instead of disabling the component", () => {
    const { updateSys, sceneManager, loop } = setup("fatal");
    loop.start();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const comp = new CrashingComponent();
    entity.add(comp);
    expect(() => updateSys.update(16)).toThrow("crash!");
    expect(comp.enabled).toBe(true);
    expect(loop.isRunning).toBe(false);
  });

  describe("timeScale", () => {
    it("scales dt by scene.timeScale for update", () => {
      const { updateSys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 0.5;
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const comp = new UpdatingComponent();
      entity.add(comp);
      updateSys.update(16);
      expect(comp.calls).toEqual([8]);
    });

    it("scales dt by scene.timeScale for fixedUpdate", () => {
      const { fixedSys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 2;
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const comp = new FixedUpdatingComponent();
      entity.add(comp);
      fixedSys.update(8);
      expect(comp.calls).toEqual([16]);
    });

    it("timeScale 0 passes dt=0 to components", () => {
      const { updateSys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 0;
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const comp = new UpdatingComponent();
      entity.add(comp);
      updateSys.update(16);
      expect(comp.calls).toEqual([0]);
    });
  });

  describe("entity.timeScale", () => {
    it("composes entity.timeScale on top of scene.timeScale (update)", () => {
      const { updateSys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 0.5;
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      entity.timeScale = 2;
      const comp = new UpdatingComponent();
      entity.add(comp);
      updateSys.update(10);
      // 10 * 0.5 * 2 = 10
      expect(comp.calls).toEqual([10]);
    });

    it("composes entity.timeScale on top of scene.timeScale (fixedUpdate)", () => {
      const { fixedSys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 2;
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      entity.timeScale = 0.25;
      const comp = new FixedUpdatingComponent();
      entity.add(comp);
      fixedSys.update(8);
      // 8 * 2 * 0.25 = 4
      expect(comp.calls).toEqual([4]);
    });

    it("entity.timeScale 0 freezes the entity even when scene runs", () => {
      const { updateSys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 1;
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      entity.timeScale = 0;
      const comp = new UpdatingComponent();
      entity.add(comp);
      updateSys.update(16);
      // 16 * 1 * 0 = 0
      expect(comp.calls).toEqual([0]);
    });

    it("defaults to 1 (no effect) when unset", () => {
      const { updateSys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const comp = new UpdatingComponent();
      entity.add(comp);
      updateSys.update(16);
      expect(comp.calls).toEqual([16]);
    });

    it("scales entities independently within the same scene", () => {
      const { updateSys, sceneManager } = setup();
      const scene = new MockScene();
      scene.timeScale = 1;
      sceneManager.activeScene = scene;
      const slow = scene.spawn("slow");
      slow.timeScale = 0.5;
      const cSlow = new UpdatingComponent();
      slow.add(cSlow);
      const fast = scene.spawn("fast");
      fast.timeScale = 2;
      const cFast = new UpdatingComponent();
      fast.add(cFast);
      updateSys.update(10);
      expect(cSlow.calls).toEqual([5]);
      expect(cFast.calls).toEqual([20]);
    });
  });

  describe("multi-scene", () => {
    it("iterates all active scenes", () => {
      const { updateSys, sceneManager } = setup();
      const scene1 = new MockScene();
      const scene2 = new MockScene();
      // Override activeScenes to return both
      Object.defineProperty(sceneManager, "activeScenes", {
        get: () => [scene1, scene2],
      });
      const e1 = scene1.spawn("a");
      const c1 = new UpdatingComponent();
      e1.add(c1);
      const e2 = scene2.spawn("b");
      const c2 = new UpdatingComponent();
      e2.add(c2);
      updateSys.update(16);
      expect(c1.calls).toEqual([16]);
      expect(c2.calls).toEqual([16]);
    });

    it("applies different timeScales per scene", () => {
      const { updateSys, sceneManager } = setup();
      const scene1 = new MockScene();
      scene1.timeScale = 0.5;
      const scene2 = new MockScene();
      scene2.timeScale = 2;
      Object.defineProperty(sceneManager, "activeScenes", {
        get: () => [scene1, scene2],
      });
      const e1 = scene1.spawn("a");
      const c1 = new UpdatingComponent();
      e1.add(c1);
      const e2 = scene2.spawn("b");
      const c2 = new UpdatingComponent();
      e2.add(c2);
      updateSys.update(10);
      expect(c1.calls).toEqual([5]);
      expect(c2.calls).toEqual([20]);
    });
  });

  describe("ComponentFixedUpdateSystem edge cases", () => {
    it("does nothing when no active scene", () => {
      const { fixedSys, sceneManager } = setup();
      sceneManager.activeScene = undefined;
      expect(() => fixedSys.update(8)).not.toThrow();
    });

    it("skips destroyed entities in fixedUpdate", () => {
      const { fixedSys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const comp = new FixedUpdatingComponent();
      entity.add(comp);
      entity.destroy();
      fixedSys.update(8);
      expect(comp.calls).toEqual([]);
    });

    it("skips disabled components in fixedUpdate", () => {
      const { fixedSys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      const comp = new FixedUpdatingComponent();
      comp.enabled = false;
      entity.add(comp);
      fixedSys.update(8);
      expect(comp.calls).toEqual([]);
    });

    it("skips components without fixedUpdate method", () => {
      const { fixedSys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      const entity = scene.spawn("test");
      entity.add(new PlainComponent());
      expect(() => fixedSys.update(8)).not.toThrow();
    });
  });
});
