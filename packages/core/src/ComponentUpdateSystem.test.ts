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
  function setup() {
    _resetEntityIdCounter();
    const logger = new Logger({ level: LogLevel.Debug });
    const boundary = new ErrorBoundary(logger);
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

  it("rethrows a crashing component's error instead of disabling it", () => {
    const { updateSys, sceneManager, boundary } = setup();
    const scene = new MockScene();
    sceneManager.activeScene = scene;
    const entity = scene.spawn("test");
    const comp = new CrashingComponent();
    entity.add(comp);
    expect(() => updateSys.update(16)).toThrow("crash!");
    expect(comp.enabled).toBe(true);
    expect(boundary.getCallbackErrors()).toHaveLength(1);
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

  describe("update order", () => {
    // Shared call log; each component appends its label from update() and
    // fixedUpdate() so a test can read the order the system used.
    const log: string[] = [];

    class Logged extends Component {
      constructor(readonly label: string) {
        super();
      }
      update() {
        log.push(this.label);
      }
      fixedUpdate() {
        log.push(`fixed:${this.label}`);
      }
    }
    // Distinct classes: an entity holds one component per class.
    class A extends Logged {}
    class B extends Logged {}
    class C extends Logged {}
    class D extends Logged {}

    class Late extends Logged {
      static updatePriority = 10;
    }
    class LateSub extends Late {}
    class Early extends Logged {
      static updatePriority = -10;
    }

    function spawn() {
      const { updateSys, fixedSys, sceneManager } = setup();
      const scene = new MockScene();
      sceneManager.activeScene = scene;
      log.length = 0;
      return { entity: scene.spawn("test"), updateSys, fixedSys };
    }

    it("runs components in add order when none declares a priority", () => {
      const { entity, updateSys } = spawn();
      entity.add(new B("b"));
      entity.add(new A("a"));
      entity.add(new C("c"));
      updateSys.update(16);
      expect(log).toEqual(["b", "a", "c"]);
    });

    it("runs in ascending updatePriority, ties in add order", () => {
      const { entity, updateSys } = spawn();
      entity.add(new A("a")).updatePriority = 5;
      entity.add(new B("b"));
      entity.add(new C("c")).updatePriority = -1;
      entity.add(new D("d")).updatePriority = 5;
      updateSys.update(16);
      expect(log).toEqual(["c", "b", "a", "d"]);
    });

    it("uses the same order for fixedUpdate", () => {
      const { entity, fixedSys } = spawn();
      entity.add(new A("a")).updatePriority = 1;
      entity.add(new B("b")).updatePriority = -1;
      fixedSys.update(8);
      expect(log).toEqual(["fixed:b", "fixed:a"]);
    });

    it("takes the class-level static as the default, inherited by subclasses", () => {
      const { entity, updateSys } = spawn();
      entity.add(new Late("late"));
      entity.add(new LateSub("lateSub"));
      entity.add(new A("a"));
      entity.add(new Early("early"));
      expect(new Late("x").updatePriority).toBe(10);
      expect(new LateSub("x").updatePriority).toBe(10);
      expect(new A("x").updatePriority).toBe(0);
      updateSys.update(16);
      expect(log).toEqual(["early", "a", "late", "lateSub"]);
    });

    it("lets an instance override its class default", () => {
      const { entity, updateSys } = spawn();
      const late = new Late("late");
      late.updatePriority = -100;
      entity.add(new A("a"));
      entity.add(late);
      updateSys.update(16);
      expect(log).toEqual(["late", "a"]);
    });

    it("re-sorts when a priority is written after add", () => {
      const { entity, updateSys } = spawn();
      const a = entity.add(new A("a"));
      entity.add(new B("b"));
      updateSys.update(16);
      expect(log).toEqual(["a", "b"]);

      log.length = 0;
      a.updatePriority = 1;
      updateSys.update(16);
      expect(log).toEqual(["b", "a"]);

      log.length = 0;
      a.updatePriority = 0;
      updateSys.update(16);
      expect(log).toEqual(["a", "b"]);
    });

    it("places a component added later by its priority, not at the end", () => {
      const { entity, updateSys } = spawn();
      entity.add(new A("a")).updatePriority = 1;
      entity.add(new B("b"));
      updateSys.update(16);
      expect(log).toEqual(["b", "a"]);

      log.length = 0;
      entity.add(new C("c")).updatePriority = -1;
      updateSys.update(16);
      expect(log).toEqual(["c", "b", "a"]);
    });

    it("drops a removed component from the order", () => {
      const { entity, updateSys } = spawn();
      entity.add(new A("a")).updatePriority = 1;
      entity.add(new B("b"));
      entity.remove(A);
      updateSys.update(16);
      expect(log).toEqual(["b"]);
      // The remaining entity keeps working after its only prioritized
      // component is gone.
      log.length = 0;
      entity.add(new C("c"));
      updateSys.update(16);
      expect(log).toEqual(["b", "c"]);
    });

    it("does not update a component that an earlier sibling removed this pass", () => {
      const { entity, updateSys } = spawn();
      class Remover extends Component {
        static updatePriority = -1;
        update() {
          log.push("remover");
          this.entity.remove(A);
        }
      }
      entity.add(new A("a"));
      entity.add(new Remover());
      updateSys.update(16);
      expect(log).toEqual(["remover"]);
      expect(entity.has(A)).toBe(false);
    });

    it("skips the remaining siblings once a component deactivates its entity mid-pass", () => {
      const { entity, updateSys } = spawn();
      class Parker extends Component {
        update() {
          log.push("parker");
          this.entity.setActive(false);
        }
      }
      // Default path (no priorities) and sorted path behave the same.
      entity.add(new Parker());
      entity.add(new A("a"));
      updateSys.update(16);
      expect(log).toEqual(["parker"]);

      log.length = 0;
      entity.setActive(true);
      entity.get(A).updatePriority = 1;
      updateSys.update(16);
      expect(log).toEqual(["parker"]);
    });

    it("keeps getAll() in add order regardless of priorities", () => {
      const { entity } = spawn();
      entity.add(new A("a")).updatePriority = 5;
      entity.add(new B("b")).updatePriority = -5;
      expect([...entity.getAll()].map((c) => (c as Logged).label)).toEqual([
        "a",
        "b",
      ]);
    });
  });
});
