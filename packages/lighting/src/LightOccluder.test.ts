import { describe, expect, it } from "vitest";
import { LightOccluder } from "./LightOccluder.js";
import type { LightOccluderShape } from "./types.js";

describe("LightOccluder", () => {
  it.each([
    ["circle radius", { type: "circle", radius: 0 }],
    ["box width", { type: "box", width: 0, height: 10 }],
    ["box height", { type: "box", width: 10, height: -1 }],
    [
      "polygon vertex count",
      {
        type: "polygon",
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ],
    [
      "polygon vertex coordinates",
      {
        type: "polygon",
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: Number.NaN },
          { x: 0, y: 10 },
        ],
      },
    ],
  ] satisfies Array<[string, LightOccluderShape]>)(
    "rejects invalid %s",
    (_label, shape) => {
      expect(() => new LightOccluder({ shape })).toThrow(RangeError);
    },
  );

  it("clones polygon input", () => {
    const shape: LightOccluderShape = {
      type: "polygon",
      vertices: [
        { x: -20, y: 10 },
        { x: 0, y: -15 },
        { x: 25, y: 12 },
      ],
    };
    const occluder = new LightOccluder({ shape, enabled: false });

    expect(occluder.shape).toEqual(shape);
    expect(occluder.shape).not.toBe(shape);
    expect(occluder.enabled).toBe(false);
    if (occluder.shape.type === "polygon" && shape.type === "polygon") {
      expect(occluder.shape.vertices).not.toBe(shape.vertices);
    }
  });
});
