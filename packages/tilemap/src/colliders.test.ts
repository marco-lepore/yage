import { describe, it, expect } from "vitest";
import { extractCollisionShapes } from "./colliders.js";
import type { TilemapData, MapObject } from "./types.js";

function makeMap(objects: MapObject[]): TilemapData {
  return {
    width: 10,
    height: 10,
    tileWidth: 16,
    tileHeight: 16,
    tileLayers: [],
    objectLayers: [
      { name: "collisions", objects, visible: true },
    ],
  };
}

function makeMultiLayerMap(
  layers: { name: string; objects: MapObject[] }[],
): TilemapData {
  return {
    width: 10,
    height: 10,
    tileWidth: 16,
    tileHeight: 16,
    tileLayers: [],
    objectLayers: layers.map((l) => ({ ...l, visible: true })),
  };
}

describe("extractCollisionShapes", () => {
  it("extracts rectangle objects as RectColliderConfig", () => {
    const rect: MapObject = {
      id: 1,
      name: "wall",
      x: 32,
      y: 48,
      width: 64,
      height: 16,
      rotation: 0,
      visible: true,
    };

    const shapes = extractCollisionShapes(makeMap([rect]));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({
      type: "rect",
      x: 32,
      y: 48,
      width: 64,
      height: 16,
    });
  });

  it("extracts polygon objects as a closed PolylineColliderConfig", () => {
    const polygon: MapObject = {
      id: 2,
      name: "slope",
      x: 10,
      y: 20,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      polygon: [
        { x: 0, y: 0 },
        { x: 32, y: 0 },
        { x: 32, y: 32 },
      ],
    };

    const shapes = extractCollisionShapes(makeMap([polygon]));
    expect(shapes).toHaveLength(1);
    // The closing edge is implicit in Tiled; the first vertex is appended so
    // the chain has a segment back to the start.
    expect(shapes[0]).toEqual({
      type: "polyline",
      x: 10,
      y: 20,
      vertices: [
        { x: 0, y: 0 },
        { x: 32, y: 0 },
        { x: 32, y: 32 },
        { x: 0, y: 0 },
      ],
    });
  });

  it("extracts polyline objects as an open PolylineColliderConfig", () => {
    const polyline: MapObject = {
      id: 7,
      name: "cliff-edge",
      x: 5,
      y: 15,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      polyline: [
        { x: 0, y: 0 },
        { x: 48, y: 16 },
        { x: 96, y: 16 },
      ],
    };

    const shapes = extractCollisionShapes(makeMap([polyline]));
    expect(shapes).toHaveLength(1);
    // Open chain: no closing vertex appended.
    expect(shapes[0]).toEqual({
      type: "polyline",
      x: 5,
      y: 15,
      vertices: [
        { x: 0, y: 0 },
        { x: 48, y: 16 },
        { x: 96, y: 16 },
      ],
    });
  });

  it("extracts square ellipse objects as a circle", () => {
    const ellipse: MapObject = {
      id: 3,
      name: "trunk",
      x: 100,
      y: 200,
      width: 32,
      height: 32,
      rotation: 0,
      visible: true,
      ellipse: true,
    };

    const shapes = extractCollisionShapes(makeMap([ellipse]));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({
      type: "circle",
      x: 100,
      y: 200,
      width: 32,
      height: 32,
      radius: 16,
    });
  });

  it("approximates a non-circular ellipse with a convex polygon", () => {
    const ellipse: MapObject = {
      id: 4,
      name: "wide",
      x: 50,
      y: 60,
      width: 40,
      height: 20,
      rotation: 0,
      visible: true,
      ellipse: true,
    };

    const shapes = extractCollisionShapes(makeMap([ellipse]));
    expect(shapes).toHaveLength(1);
    const shape = shapes[0]!;
    expect(shape.type).toBe("polygon");
    expect(shape.x).toBe(50);
    expect(shape.y).toBe(60);

    const vertices = (shape as { vertices: { x: number; y: number }[] }).vertices;
    expect(vertices.length).toBeGreaterThanOrEqual(12);
    // Every vertex lies on the ellipse centered at (w/2, h/2) with radii
    // (w/2, h/2), in coordinates relative to the object's top-left.
    for (const v of vertices) {
      const nx = (v.x - 20) / 20;
      const ny = (v.y - 10) / 10;
      expect(nx * nx + ny * ny).toBeCloseTo(1);
    }
    // The sampling spans the full extent on both axes.
    const xs = vertices.map((v) => v.x);
    const ys = vertices.map((v) => v.y);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(40);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(20);
  });

  it("extracts vertical capsule objects oriented along y", () => {
    const capsule: MapObject = {
      id: 5,
      name: "pill",
      x: 0,
      y: 0,
      width: 20,
      height: 60,
      rotation: 0,
      visible: true,
      capsule: true,
    };

    const shapes = extractCollisionShapes(makeMap([capsule]));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({
      type: "capsule",
      x: 0,
      y: 0,
      width: 20,
      height: 60,
      halfHeight: 20, // (60 - 20) / 2
      radius: 10, // 20 / 2
      axis: "y",
    });
  });

  it("extracts horizontal capsule objects oriented along x", () => {
    const capsule: MapObject = {
      id: 6,
      name: "wide-pill",
      x: 0,
      y: 0,
      width: 80,
      height: 30,
      rotation: 0,
      visible: true,
      capsule: true,
    };

    const shapes = extractCollisionShapes(makeMap([capsule]));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({
      type: "capsule",
      x: 0,
      y: 0,
      width: 80,
      height: 30,
      halfHeight: 25, // (80 - 30) / 2
      radius: 15, // 30 / 2
      axis: "x",
    });
  });

  it("skips point objects", () => {
    const point: MapObject = {
      id: 3,
      name: "spawn",
      x: 100,
      y: 200,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      point: true,
    };

    const shapes = extractCollisionShapes(makeMap([point]));
    expect(shapes).toHaveLength(0);
  });

  it("filters by objectLayerName", () => {
    const rect: MapObject = {
      id: 1,
      name: "wall",
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      visible: true,
    };

    const map = makeMultiLayerMap([
      { name: "walls", objects: [rect] },
      { name: "spawns", objects: [rect] },
    ]);

    const wallShapes = extractCollisionShapes(map, "walls");
    expect(wallShapes).toHaveLength(1);

    const spawnShapes = extractCollisionShapes(map, "spawns");
    expect(spawnShapes).toHaveLength(1);

    const missingShapes = extractCollisionShapes(map, "nonexistent");
    expect(missingShapes).toHaveLength(0);
  });

  it("handles mixed object types in one layer", () => {
    const rect: MapObject = {
      id: 1,
      name: "wall",
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      visible: true,
    };

    const polygon: MapObject = {
      id: 2,
      name: "slope",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      polygon: [
        { x: 0, y: 0 },
        { x: 16, y: 16 },
        { x: 0, y: 16 },
      ],
    };

    const point: MapObject = {
      id: 3,
      name: "spawn",
      x: 50,
      y: 50,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      point: true,
    };

    const ellipse: MapObject = {
      id: 4,
      name: "circle",
      x: 80,
      y: 80,
      width: 24,
      height: 24,
      rotation: 0,
      visible: true,
      ellipse: true,
    };

    const capsule: MapObject = {
      id: 5,
      name: "pill",
      x: 100,
      y: 100,
      width: 16,
      height: 48,
      rotation: 0,
      visible: true,
      capsule: true,
    };

    const polyline: MapObject = {
      id: 6,
      name: "ledge",
      x: 120,
      y: 120,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      polyline: [
        { x: 0, y: 0 },
        { x: 32, y: 8 },
      ],
    };

    const shapes = extractCollisionShapes(
      makeMap([rect, polygon, point, ellipse, capsule, polyline]),
    );
    expect(shapes).toHaveLength(5);
    expect(shapes.map((s) => s.type)).toEqual([
      "rect",
      "polyline",
      "circle",
      "capsule",
      "polyline",
    ]);
  });

  it("handles a concave water-edge polygon", () => {
    // A C-shaped (concave) outline traced around a water edge in Tiled.
    const concave: MapObject = {
      id: 10,
      name: "shoreline",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      polygon: [
        { x: 0, y: 0 },
        { x: 64, y: 0 },
        { x: 64, y: 16 },
        { x: 16, y: 16 },
        { x: 16, y: 48 },
        { x: 64, y: 48 },
        { x: 64, y: 64 },
        { x: 0, y: 64 },
      ],
    };

    const shapes = extractCollisionShapes(makeMap([concave]));
    expect(shapes).toHaveLength(1);
    const shape = shapes[0]!;
    expect(shape.type).toBe("polyline");
    // Vertices preserved (no convex-hull widening), plus the closing vertex.
    const vertices = (shape as { vertices: { x: number; y: number }[] }).vertices;
    expect(vertices).toHaveLength(9);
    expect(vertices[8]).toEqual(vertices[0]);
  });
});
