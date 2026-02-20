import { describe, it, expect } from "vitest";
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
