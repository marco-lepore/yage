import type { LightEdgeTexture } from "./light-edges.js";
import type { OccluderWatch } from "./occlusion.js";

/** One light's run in the shared shape texture. Coordinates are light-relative. */
export interface LightShapeSpan {
  x: number;
  y: number;
  radius: number;
  size: number;
  castShadows: boolean;
  base: number;
  edgeCount: number;
  discCount: number;
  outlineCount: number;
}

export function writeLightShapes(
  edges: LightEdgeTexture,
  occluders: OccluderWatch,
  visual: LightShapeSpan,
  outlines: number[],
): void {
  visual.base = edges.at;
  visual.edgeCount = 0;
  visual.discCount = 0;
  visual.outlineCount = 0;
  outlines.length = 0;
  if (!visual.castShadows) return;

  const x = visual.x;
  const y = visual.y;
  const halfSize = visual.size / 2;
  const reach = visual.radius + halfSize;
  const count = occluders.footprintCount();
  for (let i = 0; i < count; i++) {
    const footprint = occluders.get(i);
    if (footprint.isCircle) continue;
    if (!footprint.withinRange(x, y, reach)) continue;
    if (footprint.contains(x, y)) continue;
    const vertices = footprint.vertices;
    const vertexCount = footprint.vertexCount;
    if (footprint.withinRange(x, y, halfSize)) {
      outlines.push(visual.edgeCount, vertexCount);
    }
    for (let k = 0, j = vertexCount - 1; k < vertexCount; j = k++) {
      edges.pushEdge(
        vertices[j * 2]! - x,
        vertices[j * 2 + 1]! - y,
        vertices[k * 2]! - x,
        vertices[k * 2 + 1]! - y,
      );
      visual.edgeCount++;
    }
  }
  for (let i = 0; i < count; i++) {
    const footprint = occluders.get(i);
    if (!footprint.isCircle) continue;
    if (!footprint.withinRange(x, y, reach)) continue;
    if (footprint.contains(x, y)) continue;
    edges.pushDisc(
      footprint.centerX - x,
      footprint.centerY - y,
      footprint.radius,
    );
    visual.discCount++;
  }

  for (let i = 0; i < outlines.length; i += 2) {
    edges.pushOutline(outlines[i]!, outlines[i + 1]!);
    visual.outlineCount++;
  }
}
