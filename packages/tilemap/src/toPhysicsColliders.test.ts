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

  it("handles mixed rect and polygon shapes", () => {
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: 0, y: 0, width: 16, height: 16 },
      {
        type: "polygon",
        x: 50,
        y: 50,
        vertices: [
          { x: 0, y: 0 },
          { x: 16, y: 16 },
          { x: 0, y: 16 },
        ],
      },
    ];

    const result = toPhysicsColliders(shapes);

    expect(result).toHaveLength(2);
    expect(result[0]!.shape.type).toBe("box");
    expect(result[1]!.shape.type).toBe("polygon");
  });
});
