import { describe, it, expect, vi } from "vitest";
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

  it("extracts polygon objects as PolylineColliderConfig", () => {
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
    expect(shapes[0]).toEqual({
      type: "polyline",
      x: 10,
      y: 20,
      vertices: [
        { x: 0, y: 0 },
        { x: 32, y: 0 },
        { x: 32, y: 32 },
      ],
    });
  });

  it("extracts square ellipse objects as a circle without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns and falls back to a wider circle when ellipse width !== height", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ellipse: MapObject = {
      id: 4,
      name: "wide",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      rotation: 0,
      visible: true,
      ellipse: true,
    };

    const shapes = extractCollisionShapes(makeMap([ellipse]));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({
      type: "circle",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      radius: 20,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

    const shapes = extractCollisionShapes(
      makeMap([rect, polygon, point, ellipse, capsule]),
    );
    expect(shapes).toHaveLength(4);
    expect(shapes.map((s) => s.type)).toEqual([
      "rect",
      "polyline",
      "circle",
      "capsule",
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
    // Vertices preserved verbatim (no convex-hull widening).
    expect((shape as { vertices: { x: number; y: number }[] }).vertices).toHaveLength(8);
  });
});
