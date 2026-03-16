import { describe, it, expect, beforeEach } from "vitest";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { Transform } from "./Transform.js";
import { Vec2 } from "./Vec2.js";

describe("Transform", () => {
  describe("constructor defaults", () => {
    it("defaults to zero position, zero rotation, one scale", () => {
      const t = new Transform();
      expect(t.position.equals(Vec2.ZERO)).toBe(true);
      expect(t.rotation).toBe(0);
      expect(t.scale.equals(Vec2.ONE)).toBe(true);
    });

    it("accepts custom initial values", () => {
      const t = new Transform({
        position: new Vec2(10, 20),
        rotation: Math.PI,
        scale: new Vec2(2, 3),
      });
      expect(t.position.equals(new Vec2(10, 20))).toBe(true);
      expect(t.rotation).toBe(Math.PI);
      expect(t.scale.equals(new Vec2(2, 3))).toBe(true);
    });
  });

  describe("setPosition", () => {
    it("sets position to the given coordinates", () => {
      const t = new Transform();
      t.setPosition(5, 10);
      expect(t.position.x).toBe(5);
      expect(t.position.y).toBe(10);
    });

    it("replaces previous position", () => {
      const t = new Transform({ position: new Vec2(1, 1) });
      t.setPosition(99, 88);
      expect(t.position.x).toBe(99);
      expect(t.position.y).toBe(88);
    });
  });

  describe("translate", () => {
    it("offsets position by the given delta", () => {
      const t = new Transform({ position: new Vec2(10, 20) });
      t.translate(5, -3);
      expect(t.position.x).toBe(15);
      expect(t.position.y).toBe(17);
    });

    it("accumulates multiple translations", () => {
      const t = new Transform();
      t.translate(1, 2);
      t.translate(3, 4);
      expect(t.position.x).toBe(4);
      expect(t.position.y).toBe(6);
    });
  });

  describe("setRotation", () => {
    it("sets rotation to the given radians", () => {
      const t = new Transform();
      t.setRotation(Math.PI / 2);
      expect(t.rotation).toBe(Math.PI / 2);
    });

    it("replaces previous rotation", () => {
      const t = new Transform({ rotation: 1.0 });
      t.setRotation(2.5);
      expect(t.rotation).toBe(2.5);
    });
  });

  describe("rotate", () => {
    it("adds delta radians to current rotation", () => {
      const t = new Transform({ rotation: Math.PI });
      t.rotate(Math.PI / 4);
      expect(t.rotation).toBeCloseTo(Math.PI + Math.PI / 4);
    });

    it("accumulates multiple rotations", () => {
      const t = new Transform();
      t.rotate(0.1);
      t.rotate(0.2);
      expect(t.rotation).toBeCloseTo(0.3);
    });
  });

  describe("setScale", () => {
    it("sets scale to the given values", () => {
      const t = new Transform();
      t.setScale(2, 3);
      expect(t.scale.x).toBe(2);
      expect(t.scale.y).toBe(3);
    });

    it("replaces previous scale", () => {
      const t = new Transform({ scale: new Vec2(5, 5) });
      t.setScale(1, 1);
      expect(t.scale.x).toBe(1);
      expect(t.scale.y).toBe(1);
    });
  });
});

describe("Transform dirty-flag propagation", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("root entity: world equals local", () => {
    const e = new Entity("root");
    e.add(new Transform({ position: { x: 100, y: 200 }, rotation: 0.5 }));
    const t = e.get(Transform);

    expect(t.worldPosition.x).toBe(100);
    expect(t.worldPosition.y).toBe(200);
    expect(t.worldRotation).toBe(0.5);
    expect(t.worldScale.equals(Vec2.ONE)).toBe(true);
  });

  it("child: world position = parent world + child local", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 100, y: 50 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 20, y: 10 } }));
    parent.addChild("arm", child);

    const ct = child.get(Transform);
    expect(ct.worldPosition.x).toBe(120);
    expect(ct.worldPosition.y).toBe(60);
  });

  it("child: parent rotation rotates child position", () => {
    const parent = new Entity("parent");
    parent.add(
      new Transform({ position: { x: 0, y: 0 }, rotation: Math.PI / 2 }),
    );
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 10, y: 0 } }));
    parent.addChild("arm", child);

    const ct = child.get(Transform);
    // (10, 0) rotated 90° = (0, 10)
    expect(ct.worldPosition.x).toBeCloseTo(0, 5);
    expect(ct.worldPosition.y).toBeCloseTo(10, 5);
    expect(ct.worldRotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it("child: parent scale scales child position and scale", () => {
    const parent = new Entity("parent");
    parent.add(
      new Transform({
        position: { x: 0, y: 0 },
        scale: { x: 2, y: 3 },
      }),
    );
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 10, y: 5 } }));
    parent.addChild("arm", child);

    const ct = child.get(Transform);
    expect(ct.worldPosition.x).toBe(20); // 10 * 2
    expect(ct.worldPosition.y).toBe(15); // 5 * 3
    expect(ct.worldScale.x).toBe(2);
    expect(ct.worldScale.y).toBe(3);
  });

  it("grandchild: propagation through multiple levels", () => {
    const root = new Entity("root");
    root.add(new Transform({ position: { x: 100, y: 100 } }));
    const mid = new Entity("mid");
    mid.add(new Transform({ position: { x: 10, y: 0 } }));
    const leaf = new Entity("leaf");
    leaf.add(new Transform({ position: { x: 5, y: 0 } }));
    root.addChild("mid", mid);
    mid.addChild("leaf", leaf);

    const lt = leaf.get(Transform);
    expect(lt.worldPosition.x).toBe(115);
    expect(lt.worldPosition.y).toBe(100);
  });

  it("grandchild: rotation and scale compose", () => {
    const root = new Entity("root");
    root.add(
      new Transform({
        position: { x: 0, y: 0 },
        rotation: Math.PI / 2,
        scale: { x: 2, y: 2 },
      }),
    );
    const child = new Entity("child");
    child.add(
      new Transform({ position: { x: 5, y: 0 }, rotation: Math.PI / 2 }),
    );
    root.addChild("child", child);

    const ct = child.get(Transform);
    // (5, 0) * scale(2,2) = (10, 0), rotated 90° = (0, 10)
    expect(ct.worldPosition.x).toBeCloseTo(0, 5);
    expect(ct.worldPosition.y).toBeCloseTo(10, 5);
    expect(ct.worldRotation).toBeCloseTo(Math.PI, 5);
    expect(ct.worldScale.x).toBeCloseTo(2, 5);
    expect(ct.worldScale.y).toBeCloseTo(2, 5);
  });

  it("changing parent position dirtifies child, recompute on next access", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 0, y: 0 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 10, y: 0 } }));
    parent.addChild("arm", child);

    expect(child.get(Transform).worldPosition.x).toBe(10);

    parent.get(Transform).setPosition(50, 0);
    expect(child.get(Transform).worldPosition.x).toBe(60);
  });

  it("setPosition triggers dirty", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 0, y: 0 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 5, y: 0 } }));
    parent.addChild("c", child);

    parent.get(Transform).setPosition(10, 0);
    expect(child.get(Transform).worldPosition.x).toBe(15);
  });

  it("translate triggers dirty", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 0, y: 0 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 5, y: 0 } }));
    parent.addChild("c", child);

    parent.get(Transform).translate(10, 0);
    expect(child.get(Transform).worldPosition.x).toBe(15);
  });

  it("setRotation triggers dirty", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 0, y: 0 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 10, y: 0 } }));
    parent.addChild("c", child);

    parent.get(Transform).setRotation(Math.PI / 2);
    expect(child.get(Transform).worldPosition.x).toBeCloseTo(0, 5);
    expect(child.get(Transform).worldPosition.y).toBeCloseTo(10, 5);
  });

  it("rotate triggers dirty", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 0, y: 0 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 10, y: 0 } }));
    parent.addChild("c", child);

    parent.get(Transform).rotate(Math.PI / 2);
    expect(child.get(Transform).worldPosition.x).toBeCloseTo(0, 5);
    expect(child.get(Transform).worldPosition.y).toBeCloseTo(10, 5);
  });

  it("setScale triggers dirty", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 0, y: 0 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 10, y: 0 } }));
    parent.addChild("c", child);

    parent.get(Transform).setScale(3, 1);
    expect(child.get(Transform).worldPosition.x).toBe(30);
  });

  it("position setter triggers dirty", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 0, y: 0 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 5, y: 0 } }));
    parent.addChild("c", child);

    parent.get(Transform).position = new Vec2(20, 0);
    expect(child.get(Transform).worldPosition.x).toBe(25);
  });

  it("worldPosition setter back-computes local for child", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ position: { x: 100, y: 50 } }));
    const child = new Entity("child");
    child.add(new Transform({ position: { x: 0, y: 0 } }));
    parent.addChild("c", child);

    child.get(Transform).worldPosition = new Vec2(120, 60);
    expect(child.get(Transform).position.x).toBe(20);
    expect(child.get(Transform).position.y).toBe(10);
    expect(child.get(Transform).worldPosition.x).toBe(120);
    expect(child.get(Transform).worldPosition.y).toBe(60);
  });

  it("worldPosition setter on root sets local directly", () => {
    const e = new Entity("root");
    e.add(new Transform());
    e.get(Transform).worldPosition = new Vec2(42, 7);
    expect(e.get(Transform).position.x).toBe(42);
    expect(e.get(Transform).position.y).toBe(7);
  });

  it("worldRotation setter back-computes local for child", () => {
    const parent = new Entity("parent");
    parent.add(new Transform({ rotation: Math.PI / 2 }));
    const child = new Entity("child");
    child.add(new Transform());
    parent.addChild("c", child);

    child.get(Transform).worldRotation = Math.PI;
    expect(child.get(Transform).rotation).toBeCloseTo(Math.PI / 2, 5);
    expect(child.get(Transform).worldRotation).toBeCloseTo(Math.PI, 5);
  });

  it("worldPosition setter accounts for parent scale and rotation", () => {
    const parent = new Entity("parent");
    parent.add(
      new Transform({
        position: { x: 0, y: 0 },
        rotation: Math.PI / 2,
        scale: { x: 2, y: 2 },
      }),
    );
    const child = new Entity("child");
    child.add(new Transform());
    parent.addChild("c", child);

    // Set world position to (0, 10) — with parent rotated 90° and scaled 2x,
    // local should be (5, 0): (5,0)*scale(2,2)=(10,0), rotated 90°=(0,10)
    child.get(Transform).worldPosition = new Vec2(0, 10);
    expect(child.get(Transform).position.x).toBeCloseTo(5, 5);
    expect(child.get(Transform).position.y).toBeCloseTo(0, 5);
  });

  it("transform without entity: world equals local", () => {
    const t = new Transform({
      position: { x: 42, y: 7 },
      rotation: 1.5,
    });
    expect(t.worldPosition.x).toBe(42);
    expect(t.worldPosition.y).toBe(7);
    expect(t.worldRotation).toBe(1.5);
    expect(t.worldScale.equals(Vec2.ONE)).toBe(true);
  });
});

describe("Entity hierarchy", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("addChild / getChild", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    parent.addChild("weapon", child);

    expect(parent.getChild("weapon")).toBe(child);
    expect(child.parent).toBe(parent);
  });

  it("tryGetChild returns undefined for missing", () => {
    const parent = new Entity("parent");
    expect(parent.tryGetChild("weapon")).toBeUndefined();
  });

  it("children returns all children", () => {
    const parent = new Entity("parent");
    const a = new Entity("a");
    const b = new Entity("b");
    parent.addChild("a", a);
    parent.addChild("b", b);
    expect(parent.children.size).toBe(2);
  });

  it("throws on self-parenting", () => {
    const e = new Entity("e");
    expect(() => e.addChild("self", e)).toThrow("cannot be a child of itself");
  });

  it("throws on already-parented child", () => {
    const a = new Entity("a");
    const b = new Entity("b");
    const child = new Entity("child");
    a.addChild("c", child);
    expect(() => b.addChild("c", child)).toThrow("already has a parent");
  });

  it("throws on duplicate child name", () => {
    const parent = new Entity("parent");
    parent.addChild("arm", new Entity("a"));
    expect(() => parent.addChild("arm", new Entity("b"))).toThrow(
      'already has a child named "arm"',
    );
  });

  it("removeChild detaches without destroying", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    parent.addChild("weapon", child);
    const removed = parent.removeChild("weapon");

    expect(removed).toBe(child);
    expect(child.parent).toBeNull();
    expect(parent.children.size).toBe(0);
    expect(child.isDestroyed).toBe(false);
  });

  it("removeChild throws for missing name", () => {
    const parent = new Entity("parent");
    expect(() => parent.removeChild("nope")).toThrow('no child named "nope"');
  });

  it("destroy cascades to children", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    const grandchild = new Entity("grandchild");
    parent.addChild("child", child);
    child.addChild("grandchild", grandchild);

    parent.destroy();

    expect(parent.isDestroyed).toBe(true);
    expect(child.isDestroyed).toBe(true);
    expect(grandchild.isDestroyed).toBe(true);
  });

  it("_performDestroy detaches from parent", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    parent.addChild("weapon", child);

    child._performDestroy();

    expect(parent.children.size).toBe(0);
  });
});
