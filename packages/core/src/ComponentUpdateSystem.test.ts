import { describe, it, expect } from "vitest";
import {
  ComponentUpdateSystem,
  ComponentFixedUpdateSystem,
} from "./ComponentUpdateSystem.js";
import { Component } from "./Component.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";
import { EngineContext, SceneManagerKey, ErrorBoundaryKey } from "./EngineContext.js";
import { Phase } from "./types.js";

// Minimal SceneManager mock
class MockSceneManager {
  activeScene: MockScene | undefined;
  get active() {
    return this.activeScene;
  }
}

class MockScene {
  private entities = new Set<Entity>();
  spawn(name: string): Entity {
    const e = new Entity(name);
    e._setScene(this as never, null);
    this.entities.add(e);
    return e;
  }
  getEntities(): ReadonlySet<Entity> {
    return this.entities;
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
  function setup() {
    _resetEntityIdCounter();
    const logger = new Logger({ level: LogLevel.Debug });
    const boundary = new ErrorBoundary(logger);
    const sceneManager = new MockSceneManager();
    const ctx = new EngineContext();
    ctx.register(SceneManagerKey, sceneManager as never);
    ctx.register(ErrorBoundaryKey, boundary);

    const updateSys = new ComponentUpdateSystem();
    updateSys["context"] = ctx;
    updateSys.onRegister?.(ctx);

    const fixedSys = new ComponentFixedUpdateSystem();
    fixedSys["context"] = ctx;
    fixedSys.onRegister?.(ctx);

    return { updateSys, fixedSys, sceneManager, boundary, logger };
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
