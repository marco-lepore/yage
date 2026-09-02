import { describe, it, expect } from "vitest";
import {
  colliderRotation,
  getBoxColliderGeometry,
} from "./colliderGeometry.js";

describe("getBoxColliderGeometry", () => {
  it("shrinks the half extents by the border radius and scales density to the footprint", () => {
    const geometry = getBoxColliderGeometry({
      type: "box",
      width: 12,
      height: 44,
      borderRadius: 2,
    });

    expect(geometry.halfWidth).toBe(4);
    expect(geometry.halfHeight).toBe(20);
    expect(geometry.borderRadius).toBe(2);
    // Footprint 12×44 minus the four corner pieces, over the inner 8×40.
    const footprint = 12 * 44 - (4 - Math.PI) * 4;
    expect(geometry.areaScale).toBeCloseTo(footprint / 320);
  });

  it("treats a zero or absent radius as a plain box", () => {
    for (const shape of [
      { type: "box", width: 20, height: 10, borderRadius: 0 } as const,
      { type: "box", width: 20, height: 10 } as const,
    ]) {
      const geometry = getBoxColliderGeometry(shape);
      expect(geometry.halfWidth).toBe(10);
      expect(geometry.halfHeight).toBe(5);
      expect(geometry.borderRadius).toBe(0);
      expect(geometry.areaScale).toBe(1);
    }
  });
});

describe("colliderRotation", () => {
  it("is zero for a vertical capsule and a box without rotation", () => {
    expect(
      colliderRotation({
        shape: { type: "capsule", halfHeight: 50, radius: 25 },
      }),
    ).toBe(0);
    expect(
      colliderRotation({ shape: { type: "box", width: 10, height: 10 } }),
    ).toBe(0);
  });

  it("turns a horizontal capsule by 90° and adds the config rotation on top", () => {
    expect(
      colliderRotation({
        shape: { type: "capsule", halfHeight: 50, radius: 25, axis: "x" },
      }),
    ).toBe(Math.PI / 2);
    expect(
      colliderRotation({
        shape: { type: "capsule", halfHeight: 50, radius: 25, axis: "x" },
        rotation: Math.PI / 6,
      }),
    ).toBe(Math.PI / 2 + Math.PI / 6);
    expect(
      colliderRotation({
        shape: { type: "box", width: 10, height: 10 },
        rotation: Math.PI / 6,
      }),
    ).toBe(Math.PI / 6);
  });
});
