import { describe, it, expect } from "vitest";
import {
  assertColliderShape,
  assertFiniteNumber,
  assertPixelsPerMeter,
  assertPositiveNumber,
} from "./validate.js";
import type { ColliderShape } from "./types.js";

describe("assertFiniteNumber", () => {
  it("passes undefined, finite numbers, and numbers at the minimum", () => {
    expect(() => assertFiniteNumber("Ctx", "x", undefined)).not.toThrow();
    expect(() => assertFiniteNumber("Ctx", "x", -3)).not.toThrow();
    expect(() => assertFiniteNumber("Ctx", "x", 0, 0)).not.toThrow();
  });

  it("names the input and the constraint", () => {
    expect(() => assertFiniteNumber("Ctx", "x", NaN)).toThrow(
      "Ctx: x must be finite, got NaN.",
    );
    expect(() => assertFiniteNumber("Ctx", "x", Infinity, 0)).toThrow(
      "Ctx: x must be finite and >= 0, got Infinity.",
    );
    expect(() => assertFiniteNumber("Ctx", "x", -4, 0)).toThrow(
      "Ctx: x must be finite and >= 0, got -4.",
    );
  });
});

describe("assertPixelsPerMeter", () => {
  it("passes undefined and positive finite numbers", () => {
    expect(() => assertPixelsPerMeter("Ctx", undefined)).not.toThrow();
    expect(() => assertPixelsPerMeter("Ctx", 50)).not.toThrow();
  });

  it("rejects zero, negatives, and non-finite values", () => {
    expect(() => assertPixelsPerMeter("Ctx", 0)).toThrow(
      "Ctx: pixelsPerMeter must be finite and > 0, got 0.",
    );
    expect(() => assertPixelsPerMeter("Ctx", -50)).toThrow(
      "Ctx: pixelsPerMeter must be finite and > 0, got -50.",
    );
    expect(() => assertPixelsPerMeter("Ctx", NaN)).toThrow(
      "Ctx: pixelsPerMeter must be finite and > 0, got NaN.",
    );
  });
});

describe("assertPositiveNumber", () => {
  it("passes finite numbers above 0 and rejects everything else", () => {
    expect(() => assertPositiveNumber("Ctx", "x", 1e-6)).not.toThrow();
    expect(() => assertPositiveNumber("Ctx", "x", 0)).toThrow(
      "Ctx: x must be finite and > 0, got 0.",
    );
    expect(() => assertPositiveNumber("Ctx", "x", -20)).toThrow(
      "Ctx: x must be finite and > 0, got -20.",
    );
    expect(() => assertPositiveNumber("Ctx", "x", Infinity)).toThrow(
      "Ctx: x must be finite and > 0, got Infinity.",
    );
  });
});

describe("assertColliderShape", () => {
  const ctx = "Ctx";

  it("gates box dimensions and the border radius", () => {
    expect(() =>
      assertColliderShape(ctx, { type: "box", width: -20, height: 20 }),
    ).toThrow("Ctx: shape.width must be finite and > 0, got -20.");
    expect(() =>
      assertColliderShape(ctx, { type: "box", width: 20, height: NaN }),
    ).toThrow("Ctx: shape.height must be finite and > 0, got NaN.");
    expect(() =>
      assertColliderShape(ctx, { type: "box", width: 20, height: 0 }),
    ).toThrow("Ctx: shape.height must be finite and > 0, got 0.");
    for (const borderRadius of [20, 5, -1, NaN, Infinity]) {
      expect(() =>
        assertColliderShape(ctx, {
          type: "box",
          width: 20,
          height: 10,
          borderRadius,
        }),
      ).toThrow(
        `Ctx: shape.borderRadius must be finite, >= 0 and smaller than half the shorter side, got ${borderRadius}.`,
      );
    }
    expect(() =>
      assertColliderShape(ctx, {
        type: "box",
        width: 20,
        height: 10,
        borderRadius: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertColliderShape(ctx, {
        type: "box",
        width: 20,
        height: 10,
        borderRadius: 4.9,
      }),
    ).not.toThrow();
    expect(() =>
      assertColliderShape(ctx, { type: "box", width: 1e-6, height: 1e-6 }),
    ).not.toThrow();
  });

  it("gates circle and capsule radii, allowing a capsule with no straight section", () => {
    expect(() =>
      assertColliderShape(ctx, { type: "circle", radius: 0 }),
    ).toThrow("Ctx: shape.radius must be finite and > 0, got 0.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "capsule",
        halfHeight: 20,
        radius: -10,
      }),
    ).toThrow("Ctx: shape.radius must be finite and > 0, got -10.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "capsule",
        halfHeight: -20,
        radius: 10,
      }),
    ).toThrow("Ctx: shape.halfHeight must be finite and >= 0, got -20.");
    expect(() =>
      assertColliderShape(ctx, { type: "capsule", halfHeight: 0, radius: 10 }),
    ).not.toThrow();
    // A JavaScript caller can leave a required field out; it must be named
    // here rather than divided into Rapier as NaN.
    expect(() =>
      assertColliderShape(ctx, {
        type: "capsule",
        radius: 10,
      } as unknown as ColliderShape),
    ).toThrow("Ctx: shape.halfHeight must be finite and >= 0, got undefined.");
  });

  it("gates polygon vertex count, coordinates, and collinearity", () => {
    const line = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ x: i * 10, y: i * 5 }));
    expect(() =>
      assertColliderShape(ctx, { type: "polygon", vertices: [] }),
    ).toThrow("Ctx: shape.vertices must have at least 3 vertices, got 0.");
    expect(() =>
      assertColliderShape(ctx, { type: "polygon", vertices: line(2) }),
    ).toThrow("Ctx: shape.vertices must have at least 3 vertices, got 2.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "polygon",
        vertices: [
          { x: 0, y: 0 },
          { x: NaN, y: 0 },
          { x: 0, y: 10 },
        ],
      }),
    ).toThrow("Ctx: shape.vertices[1].x must be finite, got NaN.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "polygon",
        vertices: [{ x: 0, y: 0 }, { y: 10 }, { x: 10, y: 0 }],
      } as unknown as ColliderShape),
    ).toThrow("Ctx: shape.vertices[1].x must be finite, got undefined.");
    expect(() =>
      assertColliderShape(ctx, { type: "polygon", vertices: line(3) }),
    ).toThrow("Ctx: shape.vertices must not all lie on one line.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "polygon",
        vertices: [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
      }),
    ).toThrow("Ctx: shape.vertices must not all lie on one line.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "polygon",
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
      }),
    ).not.toThrow();
  });

  it("gates polyline vertex count and coordinates", () => {
    expect(() =>
      assertColliderShape(ctx, {
        type: "polyline",
        vertices: [{ x: 0, y: 0 }],
      }),
    ).toThrow("Ctx: shape.vertices must have at least 2 vertices, got 1.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "polyline",
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: Infinity },
        ],
      }),
    ).toThrow("Ctx: shape.vertices[1].y must be finite, got Infinity.");
    expect(() =>
      assertColliderShape(ctx, {
        type: "polyline",
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      }),
    ).not.toThrow();
  });
});
