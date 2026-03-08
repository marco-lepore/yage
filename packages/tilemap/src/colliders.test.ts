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

  it("extracts polygon objects as PolygonColliderConfig", () => {
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
      type: "polygon",
      x: 10,
      y: 20,
      vertices: [
        { x: 0, y: 0 },
        { x: 32, y: 0 },
        { x: 32, y: 32 },
      ],
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

    const shapes = extractCollisionShapes(makeMap([rect, polygon, point]));
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.type).toBe("rect");
    expect(shapes[1]!.type).toBe("polygon");
  });
});
