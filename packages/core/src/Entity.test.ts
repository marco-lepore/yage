import { describe, it, expect, vi, beforeEach } from "vitest";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { Component } from "./Component.js";

class PositionComponent extends Component {
  constructor(
    public x = 0,
    public y = 0,
  ) {
    super();
  }
}

class VelocityComponent extends Component {
  constructor(
    public vx = 0,
    public vy = 0,
  ) {
    super();
  }
}

class LifecycleComponent extends Component {
  addCalled = false;
  removeCalled = false;
  destroyCalled = false;

  onAdd() {
    this.addCalled = true;
  }
  onRemove() {
    this.removeCalled = true;
  }
  onDestroy() {
    this.destroyCalled = true;
  }
}

describe("Entity", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  describe("creation", () => {
    it("has auto-incrementing id", () => {
      const a = new Entity("a");
      const b = new Entity("b");
      expect(b.id).toBe(a.id + 1);
    });

    it("has a name", () => {
      expect(new Entity("player").name).toBe("player");
    });

    it("defaults name to Entity", () => {
      expect(new Entity().name).toBe("Entity");
    });

    it("supports tags", () => {
      const e = new Entity("e", ["enemy", "damageable"]);
      expect(e.tags.has("enemy")).toBe(true);
      expect(e.tags.has("damageable")).toBe(true);
    });

    it("starts not destroyed", () => {
      expect(new Entity().isDestroyed).toBe(false);
    });

    it("has null scene by default", () => {
      expect(new Entity().scene).toBeNull();
    });
  });

  describe("component CRUD", () => {
    it("add and get component", () => {
      const e = new Entity("test");
      const pos = new PositionComponent(10, 20);
      e.add(pos);
      expect(e.get(PositionComponent)).toBe(pos);
    });

    it("add returns the component", () => {
      const e = new Entity("test");
      const pos = new PositionComponent();
      expect(e.add(pos)).toBe(pos);
    });

    it("add sets entity back-reference", () => {
      const e = new Entity("test");
      const pos = new PositionComponent();
      e.add(pos);
      expect(pos.entity).toBe(e);
    });

    it("throws on duplicate component type", () => {
      const e = new Entity("test");
      e.add(new PositionComponent());
      expect(() => e.add(new PositionComponent())).toThrow(
        'Entity "test" already has component PositionComponent.',
      );
    });

    it("get throws for missing component", () => {
      const e = new Entity("test");
      expect(() => e.get(PositionComponent)).toThrow(
        'Entity "test" does not have component PositionComponent.',
      );
    });

    it("tryGet returns undefined for missing component", () => {
      const e = new Entity("test");
      expect(e.tryGet(PositionComponent)).toBeUndefined();
    });

    it("tryGet returns component when present", () => {
      const e = new Entity("test");
      const pos = new PositionComponent();
      e.add(pos);
      expect(e.tryGet(PositionComponent)).toBe(pos);
    });

    it("has returns correct boolean", () => {
      const e = new Entity("test");
      expect(e.has(PositionComponent)).toBe(false);
      e.add(new PositionComponent());
      expect(e.has(PositionComponent)).toBe(true);
    });

    it("remove deletes the component", () => {
      const e = new Entity("test");
      e.add(new PositionComponent());
      e.remove(PositionComponent);
      expect(e.has(PositionComponent)).toBe(false);
    });

    it("remove is a no-op for missing component", () => {
      const e = new Entity("test");
      expect(() => e.remove(PositionComponent)).not.toThrow();
    });

    it("getAll returns all components", () => {
      const e = new Entity("test");
      const pos = new PositionComponent();
      const vel = new VelocityComponent();
      e.add(pos);
      e.add(vel);
      const all = [...e.getAll()];
      expect(all).toContain(pos);
      expect(all).toContain(vel);
      expect(all).toHaveLength(2);
    });
  });

  describe("lifecycle hooks", () => {
    it("calls onAdd when component is added", () => {
      const e = new Entity("test");
      const lc = new LifecycleComponent();
      e.add(lc);
      expect(lc.addCalled).toBe(true);
    });

    it("calls onRemove and onDestroy when component is removed", () => {
      const e = new Entity("test");
      const lc = new LifecycleComponent();
      e.add(lc);
      e.remove(LifecycleComponent);
      expect(lc.removeCalled).toBe(true);
      expect(lc.destroyCalled).toBe(true);
    });
  });

  describe("destroy", () => {
    it("marks entity as destroyed", () => {
      const e = new Entity("test");
      e.destroy();
      expect(e.isDestroyed).toBe(true);
    });

    it("_performDestroy calls lifecycle hooks on all components", () => {
      const e = new Entity("test");
      const lc = new LifecycleComponent();
      e.add(lc);
      e._performDestroy();
      expect(lc.removeCalled).toBe(true);
      expect(lc.destroyCalled).toBe(true);
    });

    it("_performDestroy clears all components", () => {
      const e = new Entity("test");
      e.add(new PositionComponent());
      e._performDestroy();
      expect(e.has(PositionComponent)).toBe(false);
    });
  });

  describe("callbacks (QueryCache/EventBus notification)", () => {
    it("notifies on component add", () => {
      const e = new Entity("test");
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      e._setScene(null, { onComponentAdded: onAdd, onComponentRemoved: onRemove });
      e.add(new PositionComponent());
      expect(onAdd).toHaveBeenCalledWith(e, PositionComponent);
    });

    it("notifies on component remove", () => {
      const e = new Entity("test");
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      e._setScene(null, { onComponentAdded: onAdd, onComponentRemoved: onRemove });
      e.add(new PositionComponent());
      e.remove(PositionComponent);
      expect(onRemove).toHaveBeenCalledWith(e, PositionComponent);
    });

    it("notifies on _performDestroy", () => {
      const e = new Entity("test");
      const onRemove = vi.fn();
      e._setScene(null, { onComponentAdded: vi.fn(), onComponentRemoved: onRemove });
      e.add(new PositionComponent());
      e.add(new VelocityComponent());
      e._performDestroy();
      expect(onRemove).toHaveBeenCalledTimes(2);
    });
  });

  describe("_setScene", () => {
    it("sets scene reference", () => {
      const e = new Entity("test");
      const mockScene = { name: "test-scene" } as never;
      e._setScene(mockScene, null);
      expect(e.scene).toBe(mockScene);
    });
  });
});
