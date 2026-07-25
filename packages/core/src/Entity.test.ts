import { describe, it, expect, vi, beforeEach } from "vitest";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { Component } from "./Component.js";
import { createMockScene } from "./test-utils.js";
import { defineBlueprint } from "./Blueprint.js";

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

    it("tryScene is null for a detached entity", () => {
      expect(new Entity().tryScene).toBeNull();
    });

    it("scene throws for a detached entity", () => {
      expect(() => new Entity().scene).toThrow(/not attached to a scene/);
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
      e._setScene(null, {
        onComponentAdded: onAdd,
        onComponentRemoved: onRemove,
        onEntityActivated: vi.fn(),
        onEntityDeactivated: vi.fn(),
      });
      e.add(new PositionComponent());
      expect(onAdd).toHaveBeenCalledWith(e, PositionComponent);
    });

    it("notifies on component remove", () => {
      const e = new Entity("test");
      const onAdd = vi.fn();
      const onRemove = vi.fn();
      e._setScene(null, {
        onComponentAdded: onAdd,
        onComponentRemoved: onRemove,
        onEntityActivated: vi.fn(),
        onEntityDeactivated: vi.fn(),
      });
      e.add(new PositionComponent());
      e.remove(PositionComponent);
      expect(onRemove).toHaveBeenCalledWith(e, PositionComponent);
    });

    it("notifies on _performDestroy", () => {
      const e = new Entity("test");
      const onRemove = vi.fn();
      e._setScene(null, {
        onComponentAdded: vi.fn(),
        onComponentRemoved: onRemove,
        onEntityActivated: vi.fn(),
        onEntityDeactivated: vi.fn(),
      });
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

  describe("spawnChild", () => {
    it("spawns an anonymous child entity and parents it", () => {
      const { scene } = createMockScene();
      const parent = scene.spawn("parent");

      const child = parent.spawnChild("ui");

      expect(child.parent).toBe(parent);
      expect(parent.getChild("ui")).toBe(child);
      expect(child.tryScene).toBe(scene);
    });

    it("forwards the child name as the entity name when no factory is given", () => {
      const { scene } = createMockScene();
      const parent = scene.spawn("parent");

      const child = parent.spawnChild("ui");

      // Keeps `entity.name` in sync with the child-map key.
      expect(child.name).toBe("ui");
    });

    it("spawns an Entity subclass with setup params", () => {
      class HpComp extends Component {
        constructor(public max: number) {
          super();
        }
      }
      class HealthBar extends Entity {
        setup(params: { max: number }): void {
          this.add(new HpComp(params.max));
        }
      }
      const { scene } = createMockScene();
      const parent = scene.spawn("enemy");

      const bar = parent.spawnChild("hp", HealthBar, { max: 200 });

      expect(bar).toBeInstanceOf(HealthBar);
      expect(bar.get(HpComp).max).toBe(200);
      expect(bar.parent).toBe(parent);
    });

    it("spawns from a blueprint", () => {
      class NameTag extends Component {
        constructor(public label: string) {
          super();
        }
      }
      const Bp = defineBlueprint<{ label: string }>("bp", (entity, params) => {
        entity.add(new NameTag(params.label));
      });
      const { scene } = createMockScene();
      const parent = scene.spawn("parent");

      const child = parent.spawnChild("tag", Bp, { label: "grunt" });

      expect(child.get(NameTag).label).toBe("grunt");
      expect(child.parent).toBe(parent);
    });

    it("throws if the parent is detached from a scene", () => {
      const parent = new Entity("parent");

      expect(() => parent.spawnChild("ui")).toThrow(
        /not attached to a scene/,
      );
    });

    it("throws if the child name is already taken on the parent", () => {
      const { scene } = createMockScene();
      const parent = scene.spawn("parent");
      parent.spawnChild("ui");

      expect(() => parent.spawnChild("ui")).toThrow(
        /already has a child named "ui"/,
      );
    });

    it("does not leave an orphan in scene.entities on duplicate-name failure", () => {
      const { scene } = createMockScene();
      const parent = scene.spawn("parent");
      parent.spawnChild("ui");
      const before = scene.getEntities().size;

      expect(() => parent.spawnChild("ui")).toThrow();

      // The second call must validate before spawning so no entity is
      // inserted into scene.entities.
      expect(scene.getEntities().size).toBe(before);
    });
  });

  describe("stable identity", () => {
    it("entity.key is undefined when spawned without a key", () => {
      const { scene } = createMockScene();
      const e = scene.spawn("anon");
      expect(e.key).toBeUndefined();
    });

    it("requireKey() throws when no key is set", () => {
      const e = new Entity("loose");
      expect(() => e.requireKey()).toThrow(
        /Entity "loose".*has no stable key/,
      );
    });

    it("requireKey() returns the key when set", () => {
      const { scene } = createMockScene();
      const e = scene.spawn("npc", { key: "elder" });
      expect(e.requireKey()).toBe("elder");
    });

    it("_setKey rejects re-keying", () => {
      const e = new Entity("once");
      e._setKey("first");
      expect(() => e._setKey("second")).toThrow(/already has key "first"/);
    });
  });
});

describe("Entity activeness", () => {
  class HookComponent extends Component {
    log: string[] = [];
    onEnable() {
      this.log.push("enable");
    }
    onDisable() {
      this.log.push("disable");
    }
  }

  it("is active by default", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    expect(e.activeSelf).toBe(true);
    expect(e.isActive).toBe(true);
  });

  it("setActive(false) clears both bits, setActive(true) restores them", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    e.setActive(false);
    expect(e.activeSelf).toBe(false);
    expect(e.isActive).toBe(false);
    e.setActive(true);
    expect(e.isActive).toBe(true);
  });

  it("a child of a dormant parent is dormant but keeps its own bit", () => {
    const { scene } = createMockScene();
    const parent = scene.spawn("parent");
    const child = parent.spawnChild("child");
    parent.setActive(false);
    expect(child.activeSelf).toBe(true);
    expect(child.isActive).toBe(false);
    parent.setActive(true);
    expect(child.isActive).toBe(true);
  });

  it("a child deactivated on its own stays dormant when the parent wakes", () => {
    const { scene } = createMockScene();
    const parent = scene.spawn("parent");
    const child = parent.spawnChild("child");
    const comp = child.add(new HookComponent());
    child.setActive(false);
    parent.setActive(false);
    comp.log.length = 0;

    parent.setActive(true);
    expect(child.isActive).toBe(false);
    expect(comp.log).toEqual([]);
  });

  it("fires no hooks while spawning a child under a dormant parent", () => {
    const { scene } = createMockScene();
    const parent = scene.spawn("parent");
    parent.setActive(false);

    const child = parent.spawnChild("child");
    const comp = child.add(new HookComponent());
    expect(child.isActive).toBe(false);
    // The spawn ran `setup()` before the parent link existed, but the child was
    // never effectively enabled, so nothing was enabled and undone.
    expect(comp.log).toEqual([]);

    parent.setActive(true);
    expect(comp.log).toEqual(["enable"]);
  });

  it("leaves an entity setup() spawns on its own active, even under a dormant parent", () => {
    const { scene } = createMockScene();
    class Turret extends Entity {
      sibling?: Entity;
      setup() {
        // Not a child — an independent entity that must not inherit the
        // child's spawn-time suppression, since nothing would resync it.
        this.sibling = this.scene.spawn("sibling");
      }
    }
    const parent = scene.spawn("parent");
    parent.setActive(false);

    const turret = parent.spawnChild("turret", Turret);
    expect(turret.isActive).toBe(false);
    expect(turret.sibling!.isActive).toBe(true);
  });

  it("does not reactivate a destroyed child when the parent wakes", () => {
    const { scene } = createMockScene();
    const parent = scene.spawn("parent");
    const child = parent.spawnChild("child");
    const comp = child.add(new HookComponent());
    child.destroy();
    parent.setActive(false);
    comp.log.length = 0;

    parent.setActive(true);
    expect(child.isActive).toBe(false);
    expect(comp.log).toEqual([]);
  });

  it("propagates through grandchildren", () => {
    const { scene } = createMockScene();
    const root = scene.spawn("root");
    const mid = root.spawnChild("mid");
    const leaf = mid.spawnChild("leaf");
    root.setActive(false);
    expect(leaf.isActive).toBe(false);
    root.setActive(true);
    expect(leaf.isActive).toBe(true);
  });

  it("re-parenting under a dormant parent puts the subtree to sleep", () => {
    const { scene } = createMockScene();
    const dormant = scene.spawn("dormant");
    dormant.setActive(false);
    const loose = scene.spawn("loose");
    const leaf = loose.spawnChild("leaf");
    expect(leaf.isActive).toBe(true);

    dormant.addChild("adopted", loose);
    expect(loose.isActive).toBe(false);
    expect(leaf.isActive).toBe(false);

    dormant.removeChild("adopted");
    expect(loose.isActive).toBe(true);
    expect(leaf.isActive).toBe(true);
  });

  it("does not write per-component enabled flags", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    const comp = e.add(new HookComponent());
    comp.enabled = false;
    e.setActive(false);
    e.setActive(true);
    expect(comp.enabled).toBe(false);
    expect(comp.effectiveEnabled).toBe(false);
  });

  it("fires onEnable when a component is added to an active entity", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    const comp = e.add(new HookComponent());
    expect(comp.log).toEqual(["enable"]);
    expect(comp.effectiveEnabled).toBe(true);
  });

  it("fires no hook when a component is added to a dormant entity", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    e.setActive(false);
    const comp = e.add(new HookComponent());
    expect(comp.log).toEqual([]);
    expect(comp.effectiveEnabled).toBe(false);
    e.setActive(true);
    expect(comp.log).toEqual(["enable"]);
  });

  it("fires the hooks on each activeness flip, once per flip", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    const comp = e.add(new HookComponent());
    comp.log.length = 0;
    e.setActive(false);
    e.setActive(false);
    e.setActive(true);
    expect(comp.log).toEqual(["disable", "enable"]);
  });

  it("fires the hooks when `enabled` is written directly", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    const comp = e.add(new HookComponent());
    comp.log.length = 0;
    comp.enabled = false;
    comp.enabled = true;
    expect(comp.log).toEqual(["disable", "enable"]);
  });

  it("fires onDisable before onRemove when a component is removed", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    class OrderedComponent extends HookComponent {
      override onRemove() {
        this.log.push("remove");
      }
    }
    const comp = e.add(new OrderedComponent());
    comp.log.length = 0;
    e.remove(OrderedComponent);
    expect(comp.log).toEqual(["disable", "remove"]);
  });

  it("fires onDisable before onDestroy when the entity is destroyed", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    class OrderedComponent extends HookComponent {
      override onDestroy() {
        this.log.push("destroy");
      }
    }
    const comp = e.add(new OrderedComponent());
    comp.log.length = 0;
    e.destroy();
    scene._flushDestroyQueue();
    expect(comp.log).toEqual(["disable", "destroy"]);
  });

  it("skips onDisable at teardown for an already-dormant entity", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    const comp = e.add(new HookComponent());
    e.setActive(false);
    comp.log.length = 0;
    e.destroy();
    scene._flushDestroyQueue();
    expect(comp.log).toEqual([]);
  });

  it("propagates a throwing onDisable to the caller", () => {
    const { scene } = createMockScene();
    const e = scene.spawn("e");
    class ThrowingComponent extends Component {
      onDisable() {
        throw new Error("boom");
      }
    }
    e.add(new ThrowingComponent());
    expect(() => e.setActive(false)).toThrow("boom");
  });
});
