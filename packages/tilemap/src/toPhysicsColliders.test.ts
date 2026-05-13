import { describe, it, expect } from "vitest";
import { toPhysicsColliders } from "./toPhysicsColliders.js";
import type { TilemapColliderConfig } from "./types.js";

describe("toPhysicsColliders", () => {
  it("converts rect to box with centered offset", () => {
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: 32, y: 48, width: 64, height: 16 },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      shape: { type: "box", width: 64, height: 16 },
      offset: { x: 32 + 32, y: 48 + 8 }, // x + w/2, y + h/2
    });
  });

  it("converts circle to ball with centered offset", () => {
    const shapes: TilemapColliderConfig[] = [
      { type: "circle", x: 100, y: 200, width: 40, height: 40, radius: 20 },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      shape: { type: "circle", radius: 20 },
      offset: { x: 120, y: 220 },
    });
  });

  it("converts vertical capsule with axis 'y'", () => {
    const shapes: TilemapColliderConfig[] = [
      {
        type: "capsule",
        x: 0,
        y: 0,
        width: 20,
        height: 60,
        halfHeight: 20,
        radius: 10,
        axis: "y",
      },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      shape: { type: "capsule", halfHeight: 20, radius: 10, axis: "y" },
      offset: { x: 10, y: 30 },
    });
  });

  it("converts horizontal capsule with axis 'x'", () => {
    const shapes: TilemapColliderConfig[] = [
      {
        type: "capsule",
        x: 0,
        y: 0,
        width: 80,
        height: 30,
        halfHeight: 25,
        radius: 15,
        axis: "x",
      },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      shape: { type: "capsule", halfHeight: 25, radius: 15, axis: "x" },
      offset: { x: 40, y: 15 },
    });
  });

  it("converts polyline preserving vertices and origin offset", () => {
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polyline",
        x: 10,
        y: 20,
        vertices: [
          { x: 0, y: 0 },
          { x: 32, y: 0 },
          { x: 32, y: 32 },
          { x: 0, y: 32 },
        ],
      },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      shape: {
        type: "polyline",
        vertices: [
          { x: 0, y: 0 },
          { x: 32, y: 0 },
          { x: 32, y: 32 },
          { x: 0, y: 32 },
        ],
      },
      offset: { x: 10, y: 20 },
    });
  });

  it("converts polygon with origin offset", () => {
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polygon",
        x: 10,
        y: 20,
        vertices: [
          { x: 0, y: 0 },
          { x: 32, y: 0 },
          { x: 32, y: 32 },
        ],
      },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      shape: {
        type: "polygon",
        vertices: [
          { x: 0, y: 0 },
          { x: 32, y: 0 },
          { x: 32, y: 32 },
        ],
      },
      offset: { x: 10, y: 20 },
    });
  });

  it("returns empty array for empty input", () => {
    expect(toPhysicsColliders([])).toEqual([]);
  });

  it("handles mixed rect, polyline, circle, and capsule shapes", () => {
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: 0, y: 0, width: 16, height: 16 },
      {
        type: "polyline",
        x: 50,
        y: 50,
        vertices: [
          { x: 0, y: 0 },
          { x: 16, y: 16 },
          { x: 0, y: 16 },
        ],
      },
      { type: "circle", x: 0, y: 0, width: 20, height: 20, radius: 10 },
      {
        type: "capsule",
        x: 0,
        y: 0,
        width: 20,
        height: 60,
        halfHeight: 20,
        radius: 10,
        axis: "y",
      },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(4);
    expect(result.map((r) => r.shape.type)).toEqual([
      "box",
      "polyline",
      "circle",
      "capsule",
    ]);
  });
});
