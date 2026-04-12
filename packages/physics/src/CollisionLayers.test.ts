import { describe, it, expect } from "vitest";
import { CollisionLayers } from "./CollisionLayers.js";

describe("CollisionLayers", () => {
  describe("define()", () => {
    it("assigns sequential powers of 2", () => {
      const layers = new CollisionLayers();
      expect(layers.define("player")).toBe(1);
      expect(layers.define("enemy")).toBe(2);
      expect(layers.define("projectile")).toBe(4);
      expect(layers.define("terrain")).toBe(8);
    });

    it("throws on duplicate name", () => {
      const layers = new CollisionLayers();
      layers.define("player");
      expect(() => layers.define("player")).toThrow(
        'Collision layer "player" is already defined',
      );
    });

    it("throws when exceeding 16 layers", () => {
      const layers = new CollisionLayers();
      for (let i = 0; i < 16; i++) {
        layers.define(`layer${i}`);
      }
      expect(() => layers.define("overflow")).toThrow(
        "Cannot define more than 16 collision layers",
      );
    });
  });

  describe("get()", () => {
    it("returns the correct bitmask for a defined layer", () => {
      const layers = new CollisionLayers();
      layers.define("player");
      layers.define("enemy");
      expect(layers.get("player")).toBe(1);
      expect(layers.get("enemy")).toBe(2);
    });

    it("throws for undefined layer", () => {
      const layers = new CollisionLayers();
      expect(() => layers.get("nonexistent")).toThrow(
        'Collision layer "nonexistent" is not defined',
      );
    });
  });

  describe("combine()", () => {
    it("ORs multiple layers together", () => {
      const layers = new CollisionLayers();
      layers.define("player");
      layers.define("enemy");
      layers.define("projectile");
      expect(layers.combine("player", "enemy")).toBe(1 | 2);
      expect(layers.combine("player", "projectile")).toBe(1 | 4);
      expect(layers.combine("player", "enemy", "projectile")).toBe(1 | 2 | 4);
    });

    it("returns 0 for no arguments", () => {
      const layers = new CollisionLayers();
      expect(layers.combine()).toBe(0);
    });

    it("returns single layer for one argument", () => {
      const layers = new CollisionLayers();
      layers.define("player");
      expect(layers.combine("player")).toBe(1);
    });
  });

  describe("interactionGroups()", () => {
    it("encodes membership in upper 16 bits and filter in lower 16 bits", () => {
      const result = CollisionLayers.interactionGroups(0x0001, 0x0003);
      expect(result).toBe((0x0001 << 16) | 0x0003);
    });

    it("handles full membership and filter masks", () => {
      const result = CollisionLayers.interactionGroups(0xffff, 0xffff);
      expect(result >>> 0).toBe(0xffffffff >>> 0);
    });

    it("masks values to 16 bits", () => {
      const result = CollisionLayers.interactionGroups(0x10001, 0x20002);
      // Only lower 16 bits kept: 0x0001, 0x0002
      expect(result).toBe((0x0001 << 16) | 0x0002);
    });

    it("encodes zero membership and filter", () => {
      const result = CollisionLayers.interactionGroups(0, 0);
      expect(result).toBe(0);
    });
  });
});
