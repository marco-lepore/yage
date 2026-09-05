import { expect, it } from "vitest";
import { Transform } from "./Transform.js";
import { Vec2 } from "./Vec2.js";
import { Vec2Buffer } from "./Vec2Buffer.js";
import { Entity } from "./Entity.js";

const mutations: [string, (t: Transform, value: number) => void][] = [
  [
    "position",
    (t, value) => {
      t.position = new Vec2(3, value);
    },
  ],
  [
    "scale",
    (t, value) => {
      t.scale = new Vec2(3, value);
    },
  ],
  [
    "rotation",
    (t, value) => {
      t.rotation = value;
    },
  ],
  [
    "worldPosition",
    (t, value) => {
      t.worldPosition = new Vec2(3, value);
    },
  ],
  [
    "worldRotation",
    (t, value) => {
      t.worldRotation = value;
    },
  ],
  ["setWorldPosition", (t, value) => t.setWorldPosition(3, value)],
  ["setPosition", (t, value) => t.setPosition(3, value)],
  ["setScale", (t, value) => t.setScale(3, value)],
  ["setRotation", (t, value) => t.setRotation(value)],
  ["translate", (t, value) => t.translate(3, value)],
  ["rotate", (t, value) => t.rotate(value)],
];

for (const value of [NaN, Infinity, -Infinity]) {
  for (const [method, mutate] of mutations) {
    it(`${method} rejects ${value} before changing state`, () => {
      const t = new Transform({
        position: { x: 1, y: 2 },
        rotation: 3,
        scale: { x: 4, y: 5 },
      });
      const position = t.position;
      const scale = t.scale;
      expect(() => mutate(t, value)).toThrow(`Transform.${method}:`);
      expect(t.position).toBe(position);
      expect(t.scale).toBe(scale);
      expect(t.rotation).toBe(3);
    });
  }

  for (const options of [
    { position: { x: value, y: 0 } },
    { position: { x: 0, y: value } },
    { scale: { x: value, y: 0 } },
    { scale: { x: 0, y: value } },
    { rotation: value },
  ]) {
    it(`constructor rejects ${JSON.stringify(options)} (${value})`, () => {
      expect(() => new Transform(options)).toThrow("Transform.constructor:");
    });
  }
}

it("translation overflow leaves both coordinates unchanged", () => {
  const t = new Transform({ position: { x: 1, y: Number.MAX_VALUE } });
  const position = t.position;
  expect(() => t.translate(2, Number.MAX_VALUE)).toThrow(
    "Transform.translate: y must be finite, got Infinity.",
  );
  expect(t.position).toBe(position);
});

it("rotation overflow preserves the old rotation", () => {
  const t = new Transform({ rotation: Number.MAX_VALUE });
  expect(() => t.rotate(Number.MAX_VALUE)).toThrow(
    "Transform.rotate: rotation must be finite, got Infinity.",
  );
  expect(t.rotation).toBe(Number.MAX_VALUE);
});

it("world assignment rejects overflow in conversion before updating either local coordinate", () => {
  const parent = new Entity("parent");
  parent.add(new Transform({ scale: { x: 1, y: Number.MIN_VALUE } }));
  const child = new Entity("child");
  const t = child.add(new Transform({ position: { x: 1, y: 2 } }));
  parent.addChild("child", child);
  const position = t.position;
  expect(() => {
    t.worldPosition = new Vec2(3, Number.MAX_VALUE);
  }).toThrow("Transform.worldPosition: local y must be finite, got Infinity.");
  expect(t.position).toBe(position);
});

it("world rotation rejects overflow without changing local rotation", () => {
  const parent = new Entity("parent");
  parent.add(new Transform({ rotation: -Number.MAX_VALUE }));
  const child = new Entity("child");
  const t = child.add(new Transform({ rotation: 2 }));
  parent.addChild("child", child);
  expect(() => {
    t.worldRotation = Number.MAX_VALUE;
  }).toThrow(
    "Transform.worldRotation: local rotation must be finite, got Infinity.",
  );
  expect(t.rotation).toBe(2);
});

it("constructor copies authored vectors and preserves default singleton identity", () => {
  const position = new Vec2(1, 2);
  const scale = new Vec2(3, 4);
  const t = new Transform({ position, scale });
  expect(t.position).not.toBe(position);
  expect(t.scale).not.toBe(scale);
  expect(t.position).toEqual(position);
  expect(t.scale).toEqual(scale);
  expect(new Transform().position).toBe(Vec2.ZERO);
  expect(new Transform().scale).toBe(Vec2.ONE);
});

it("vector setters preserve supplied references at the root", () => {
  const t = new Transform();
  const value = new Vec2(5, 6);
  t.position = value;
  t.scale = value;
  expect(t.position).toBe(value);
  expect(t.worldPosition).toBe(value);
  expect(t.scale).toBe(value);
  expect(t.worldScale).toBe(value);
  const next = new Vec2(7, 8);
  t.worldPosition = next;
  expect(t.position).toBe(next);
  expect(t.worldPosition).toBe(next);
});

it("scalar writes retain root snapshot identity in either read order", () => {
  const t = new Transform();
  t.setPosition(5, 6);
  t.setScale(7, 8);
  expect(t.worldPosition).toBe(t.position);
  expect(t.scale).toBe(t.worldScale);
  const position = t.position;
  const scale = t.scale;
  t.setPosition(5, 6);
  t.setScale(7, 8);
  expect(t.position).not.toBe(position);
  expect(t.scale).not.toBe(scale);
  expect(t.position).toBe(t.worldPosition);
  expect(t.worldScale).toBe(t.scale);
});

it("previously returned snapshots survive scalar writes and rotations", () => {
  const t = new Transform();
  t.setPosition(1, 2);
  t.setScale(3, 4);
  const position = t.position;
  const scale = t.scale;
  t.translate(10, 20);
  t.setScale(5, 6);
  t.rotate(1);
  expect(position).toEqual(new Vec2(1, 2));
  expect(scale).toEqual(new Vec2(3, 4));
  expect(t.position).toEqual(new Vec2(11, 22));
});

it("parent updates invalidate world snapshots while preserving old objects", () => {
  const parent = new Entity("parent");
  const pt = parent.add(new Transform({ position: { x: 10, y: 20 } }));
  const child = new Entity("child");
  const t = child.add(new Transform({ position: { x: 1, y: 2 } }));
  parent.addChild("child", child);
  const world = t.worldPosition;
  const scale = t.worldScale;
  expect(t.worldPosition).toBe(world);
  expect(t.worldScale).toBe(scale);
  pt.setPosition(20, 30);
  expect(t.worldPosition).toEqual(new Vec2(21, 32));
  expect(t.worldPosition).not.toBe(world);
  expect(t.worldScale).not.toBe(scale);
  expect(world).toEqual(new Vec2(11, 22));
  expect(scale).toEqual(Vec2.ONE);
});

it("a scalar world rotation read does not disturb snapshot identities", () => {
  const parent = new Entity("parent");
  parent.add(new Transform({ rotation: 0.3, scale: { x: -2, y: 3 } }));
  const child = new Entity("child");
  const t = child.add(new Transform());
  parent.addChild("child", child);
  t.setPosition(5, 6);
  expect(t.worldRotation).toBe(0.3);
  const world = t.worldPosition;
  const scale = t.worldScale;
  expect(t.worldPosition).toBe(world);
  expect(t.worldScale).toBe(scale);
  expect(t.worldToLocal(world).x).toBeCloseTo(0);
  expect(t.worldToLocal(world).y).toBeCloseTo(0);
});

it("Into reads reuse caller scratch and snapshots survive unrelated writes", () => {
  const t = new Transform({ position: { x: 1, y: 2 }, scale: { x: 3, y: 4 } });
  const position = new Vec2Buffer();
  const scale = new Vec2Buffer();
  expect(t.getPositionInto(position)).toBe(position);
  expect(t.getWorldPositionInto(position)).toBe(position);
  expect(t.getScaleInto(scale)).toBe(scale);
  expect(t.getWorldScaleInto(scale)).toBe(scale);
  t.setPosition(9, 8);
  t.setScale(7, 6);
  expect(position).toEqual(new Vec2Buffer(1, 2));
  expect(scale).toEqual(new Vec2Buffer(3, 4));
  expect(t.getWorldPositionInto(position)).toEqual(new Vec2Buffer(9, 8));
  expect(t.getWorldScaleInto(scale)).toEqual(new Vec2Buffer(7, 6));
});

it("nested dirty writes, reparenting and unparenting use current scalar poses", () => {
  const a = new Entity("a");
  const at = a.add(
    new Transform({ position: { x: 10, y: 20 }, scale: { x: -2, y: 3 } }),
  );
  const b = new Entity("b");
  b.add(new Transform({ position: { x: 1, y: 2 } }));
  const child = new Entity("child");
  const t = child.add(new Transform({ position: { x: 4, y: 5 } }));
  a.addChild("b", b);
  b.addChild("child", child);
  const out = new Vec2Buffer();
  expect(t.getWorldPositionInto(out)).toEqual(new Vec2Buffer(0, 41));
  at.setPosition(20, 30);
  at.setPosition(30, 40);
  t.setPosition(5, 6);
  expect(t.getWorldPositionInto(out)).toEqual(new Vec2Buffer(18, 64));
  b.removeChild("child");
  expect(t.getWorldPositionInto(out)).toEqual(new Vec2Buffer(5, 6));
  a.addChild("child", child);
  expect(t.getWorldPositionInto(out)).toEqual(new Vec2Buffer(20, 58));
  t.setWorldPosition(24, 70);
  expect(t.getPositionInto(out)).toEqual(new Vec2Buffer(3, 10));
});

it("scalar world assignment rejects inverse overflow before local mutation", () => {
  const parent = new Entity("parent");
  parent.add(new Transform({ scale: { x: 1, y: Number.MIN_VALUE } }));
  const child = new Entity("child");
  const t = child.add(new Transform({ position: { x: 1, y: 2 } }));
  parent.addChild("child", child);
  const position = t.position;
  expect(() => t.setWorldPosition(3, Number.MAX_VALUE)).toThrow(
    "Transform.setWorldPosition: local y must be finite, got Infinity.",
  );
  expect(t.position).toBe(position);
});
