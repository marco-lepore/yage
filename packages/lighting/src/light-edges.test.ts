import { describe, expect, it, vi } from "vitest";
import { LightEdgeTexture } from "./light-edges.js";
import { EDGE_TEXTURE_WIDTH } from "./light-shader.js";

/** The floats of one written shape. */
function shapeAt(edges: LightEdgeTexture, index: number): number[] {
  const texels = edges.source.resource as Float32Array;
  return Array.from(texels.subarray(index * 4, index * 4 + 4));
}

describe("LightEdgeTexture", () => {
  it("writes edges and discs in the order they arrive", () => {
    const edges = new LightEdgeTexture("test");
    edges.begin();
    edges.pushEdge(1, 2, 3, 4);
    edges.pushDisc(5, 6, 7);

    expect(shapeAt(edges, 0)).toEqual([1, 2, 3, 4]);
    expect(shapeAt(edges, 1)).toEqual([5, 6, 7, 0]);
    expect(edges.at).toBe(2);
    edges.destroy();
  });

  it("starts a frame over and leaves a skipped run where it stands", () => {
    const edges = new LightEdgeTexture("test");
    edges.begin();
    edges.pushEdge(1, 2, 3, 4);
    edges.pushEdge(5, 6, 7, 8);

    edges.begin();
    edges.skip(2);
    expect(edges.at).toBe(2);
    expect(shapeAt(edges, 0)).toEqual([1, 2, 3, 4]);
    edges.destroy();
  });

  it("uploads only the frames that wrote something", () => {
    const edges = new LightEdgeTexture("test");
    const update = vi.spyOn(edges.source, "update");

    edges.begin();
    edges.pushEdge(1, 2, 3, 4);
    edges.flush();
    expect(update).toHaveBeenCalledTimes(1);

    edges.begin();
    edges.skip(1);
    edges.flush();
    expect(update).toHaveBeenCalledTimes(1);
    edges.destroy();
  });

  it("grows past its first size, keeping what it already held", () => {
    const edges = new LightEdgeTexture("test");
    edges.begin();
    const count = EDGE_TEXTURE_WIDTH * 9;
    for (let index = 0; index < count; index++) {
      edges.pushEdge(index, 0, 0, 0);
    }

    expect(edges.source.height).toBeGreaterThanOrEqual(9);
    expect(shapeAt(edges, 0)).toEqual([0, 0, 0, 0]);
    expect(shapeAt(edges, count - 1)).toEqual([count - 1, 0, 0, 0]);
    edges.destroy();
  });
});
