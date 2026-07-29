import { describe, expect, it } from "vitest";
import { LightOccluder } from "./LightOccluder.js";
import type { LightOccluderData } from "./LightOccluder.js";
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

  it("restores a cloned polygon snapshot", () => {
    const data: LightOccluderData = {
      shape: {
        type: "polygon",
        vertices: [
          { x: -20, y: 10 },
          { x: 0, y: -15 },
          { x: 25, y: 12 },
        ],
      },
      enabled: false,
    };

    const restored = LightOccluder.fromSnapshot(data);

    expect(restored.serialize()).toEqual(data);
    expect(restored.shape).not.toBe(data.shape);
    if (restored.shape.type === "polygon" && data.shape.type === "polygon") {
      expect(restored.shape.vertices).not.toBe(data.shape.vertices);
    }
  });
});
