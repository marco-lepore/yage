import { describe, expect, it } from "vitest";
import { scaleColliderPart } from "./colliderScale.js";

describe("scaleColliderPart", () => {
  it("keeps primitives for positive uniform scale", () => {
    expect(
      scaleColliderPart(
        {
          shape: {
            type: "box",
            width: 20,
            height: 10,
            borderRadius: 2,
          },
          offset: { x: 3, y: -4 },
          rotation: 0.5,
        },
        3,
        3,
      ),
    ).toEqual({
      shape: {
        type: "box",
        width: 60,
        height: 30,
        borderRadius: 6,
      },
      offset: { x: 9, y: -12 },
      rotation: 0.5,
    });
  });

  it("bakes non-uniform scale, rotation, and offset into an exact box hull", () => {
    const scaled = scaleColliderPart(
      {
        shape: { type: "box", width: 2, height: 4 },
        offset: { x: 1, y: 2 },
        rotation: Math.PI / 2,
      },
      2,
      3,
    );

    expect(scaled.shape.type).toBe("polygon");
    if (scaled.shape.type !== "polygon") return;
    const expected = [
      [6, 3],
      [6, 9],
      [-2, 9],
      [-2, 3],
    ];
    scaled.shape.vertices.forEach((vertex, index) => {
      expect(vertex.x).toBeCloseTo(expected[index]![0]!);
      expect(vertex.y).toBeCloseTo(expected[index]![1]!);
    });
    expect(scaled.offset).toBeUndefined();
    expect(scaled.rotation).toBeUndefined();
  });

  it("keeps polygon and polyline vertices exact under signed scale", () => {
    const polygon = scaleColliderPart(
      {
        shape: {
          type: "polygon",
          vertices: [
            { x: 1, y: 2 },
            { x: 3, y: 2 },
            { x: 1, y: 4 },
          ],
        },
      },
      -2,
      3,
    );
    const polyline = scaleColliderPart(
      {
        shape: {
          type: "polyline",
          vertices: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      },
      -2,
      3,
    );

    expect(polygon.shape).toEqual({
      type: "polygon",
      vertices: [
        { x: -2, y: 6 },
        { x: -6, y: 6 },
        { x: -2, y: 12 },
      ],
    });
    expect(polyline.shape).toEqual({
      type: "polyline",
      vertices: [
        { x: -2, y: 6 },
        { x: -6, y: 12 },
      ],
    });
  });

  it.each([
    [{ type: "circle", radius: 5 } as const, 32],
    [{ type: "capsule", halfHeight: 10, radius: 5 } as const, 32],
    [
      {
        type: "box",
        width: 20,
        height: 10,
        borderRadius: 2,
      } as const,
      32,
    ],
  ])("samples curved %s geometry with %s points", (shape, count) => {
    const scaled = scaleColliderPart({ shape }, 2, 3);

    expect(scaled.shape.type).toBe("polygon");
    if (scaled.shape.type !== "polygon") return;
    expect(scaled.shape.vertices).toHaveLength(count);
  });
});
