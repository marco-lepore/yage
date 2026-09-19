import { Vec2Buffer } from "@yagejs/core";
import type { LightOccluder } from "./LightOccluder.js";
import type { LightOccluderShape } from "./types.js";

/** Vertices that outline a circle whose entity scale is not uniform. */
const CIRCLE_OUTLINE_VERTICES = 32;

/**
 * @internal Footprints for a whole occluder set, resolved once and then read
 * many times. The query and the renderer both work from one of these, so the
 * light a game asks about and the light it sees come from the same geometry.
 */
export class OccluderFootprintPool {
  private readonly scratch = new Vec2Buffer();
  private readonly footprints: OccluderFootprint[] = [];
  /** How many entries the last {@link refresh} filled. */
  count = 0;

  /** Re-read every occluder's current world transform and shape. */
  refresh(occluders: Iterable<LightOccluder>): void {
    let count = 0;
    for (const occluder of occluders) {
      const footprint = (this.footprints[count] ??= new OccluderFootprint());
      footprint.resolve(occluder, this.scratch);
      count++;
    }
    this.count = count;
  }

  /** The footprint at `index`, valid while `index` is below {@link count}. */
  get(index: number): OccluderFootprint {
    return this.footprints[index]!;
  }
}

/**
 * @internal One occluder's world-space footprint, resolved from its component
 * once and then reused across every light and every sampled point of a query.
 *
 * A circle under a uniform positive entity scale stays a circle; every other
 * shape becomes a world-space polygon. That is the rule a physics collider
 * follows, so a scaled wall shadows the area it collides over.
 */
export class OccluderFootprint {
  /** Whether the footprint is a circle; otherwise {@link vertices} holds it. */
  isCircle = false;
  centerX = 0;
  centerY = 0;
  radius = 0;
  /** World-space outline as flat `x, y` pairs. */
  vertices = new Float64Array(CIRCLE_OUTLINE_VERTICES * 2);
  vertexCount = 0;
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  /** Read one occluder's current world transform and shape into this buffer. */
  resolve(occluder: LightOccluder, scratch: Vec2Buffer): void {
    const position = occluder.getPositionInto(scratch);
    const originX = position.x;
    const originY = position.y;
    const scale = occluder.scale;
    const scaleX = scale.x;
    const scaleY = scale.y;
    const shape = occluder.shape;

    if (shape.type === "circle" && scaleX > 0 && scaleX === scaleY) {
      const radius = shape.radius * scaleX;
      this.isCircle = true;
      this.centerX = originX;
      this.centerY = originY;
      this.radius = radius;
      this.minX = originX - radius;
      this.minY = originY - radius;
      this.maxX = originX + radius;
      this.maxY = originY + radius;
      return;
    }

    this.isCircle = false;
    const count = this.writeLocalOutline(shape, scaleX, scaleY);
    this.vertexCount = count;

    const rotation = occluder.rotation;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const vertices = this.vertices;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const offset = i * 2;
      const localX = vertices[offset]!;
      const localY = vertices[offset + 1]!;
      const x = originX + localX * cos - localY * sin;
      const y = originY + localX * sin + localY * cos;
      vertices[offset] = x;
      vertices[offset + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /** Whether the closed footprint covers a point. */
  contains(x: number, y: number): boolean {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) {
      return false;
    }
    if (this.isCircle) {
      const dx = x - this.centerX;
      const dy = y - this.centerY;
      return dx * dx + dy * dy <= this.radius * this.radius;
    }
    const vertices = this.vertices;
    const count = this.vertexCount;
    let inside = false;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const ix = vertices[i * 2]!;
      const iy = vertices[i * 2 + 1]!;
      const jx = vertices[j * 2]!;
      const jy = vertices[j * 2 + 1]!;
      if (iy > y !== jy > y && x < ((jx - ix) * (y - iy)) / (jy - iy) + ix) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Whether the footprint is near enough to shadow anything a light reaches. */
  withinRange(x: number, y: number, radius: number): boolean {
    const dx =
      x < this.minX ? this.minX - x : x > this.maxX ? x - this.maxX : 0;
    const dy =
      y < this.minY ? this.minY - y : y > this.maxY ? y - this.maxY : 0;
    return dx * dx + dy * dy <= radius * radius;
  }

  /** Whether the closed footprint touches the segment. */
  blocks(x1: number, y1: number, x2: number, y2: number): boolean {
    // A point queried at a light's own position gives a segment with no
    // direction, which the edge tests below cannot read. It meets the
    // footprint exactly when the footprint covers it.
    if (x1 === x2 && y1 === y2) return this.contains(x2, y2);
    if (
      Math.max(x1, x2) < this.minX ||
      Math.min(x1, x2) > this.maxX ||
      Math.max(y1, y2) < this.minY ||
      Math.min(y1, y2) > this.maxY
    ) {
      return false;
    }
    if (this.isCircle) {
      const radius = this.radius;
      return (
        segmentPointDistanceSquared(
          x1,
          y1,
          x2,
          y2,
          this.centerX,
          this.centerY,
        ) <=
        radius * radius
      );
    }
    if (this.contains(x2, y2)) return true;
    const vertices = this.vertices;
    const count = this.vertexCount;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      if (
        segmentsTouch(
          x1,
          y1,
          x2,
          y2,
          vertices[j * 2]!,
          vertices[j * 2 + 1]!,
          vertices[i * 2]!,
          vertices[i * 2 + 1]!,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /** Write the shape's scaled outline in entity-local pixels; returns its length. */
  private writeLocalOutline(
    shape: LightOccluderShape,
    scaleX: number,
    scaleY: number,
  ): number {
    switch (shape.type) {
      case "circle": {
        const vertices = this.ensureCapacity(CIRCLE_OUTLINE_VERTICES);
        for (let i = 0; i < CIRCLE_OUTLINE_VERTICES; i++) {
          const angle = (i / CIRCLE_OUTLINE_VERTICES) * Math.PI * 2;
          vertices[i * 2] = Math.cos(angle) * shape.radius * scaleX;
          vertices[i * 2 + 1] = Math.sin(angle) * shape.radius * scaleY;
        }
        return CIRCLE_OUTLINE_VERTICES;
      }
      case "box": {
        const halfWidth = (shape.width / 2) * scaleX;
        const halfHeight = (shape.height / 2) * scaleY;
        const vertices = this.ensureCapacity(4);
        vertices[0] = -halfWidth;
        vertices[1] = -halfHeight;
        vertices[2] = halfWidth;
        vertices[3] = -halfHeight;
        vertices[4] = halfWidth;
        vertices[5] = halfHeight;
        vertices[6] = -halfWidth;
        vertices[7] = halfHeight;
        return 4;
      }
      case "polygon": {
        const source = shape.vertices;
        const vertices = this.ensureCapacity(source.length);
        for (let i = 0; i < source.length; i++) {
          vertices[i * 2] = source[i]!.x * scaleX;
          vertices[i * 2 + 1] = source[i]!.y * scaleY;
        }
        return source.length;
      }
    }
  }

  private ensureCapacity(vertexCount: number): Float64Array {
    if (this.vertices.length < vertexCount * 2) {
      this.vertices = new Float64Array(vertexCount * 2);
    }
    return this.vertices;
  }
}

/** Squared distance from a point to the closest point on a segment. */
function segmentPointDistanceSquared(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  px: number,
  py: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const offsetX = px - closestX;
  const offsetY = py - closestY;
  return offsetX * offsetX + offsetY * offsetY;
}

/**
 * Whether two closed segments share at least one point. Grazing a corner
 * counts, so two occluders that meet at an edge leave no gap for light.
 */
function segmentsTouch(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const d1 = abx * (cy - ay) - aby * (cx - ax);
  const d2 = abx * (dy - ay) - aby * (dx - ax);
  if (d1 === 0 && d2 === 0) {
    // Collinear: they meet only where their bounding boxes overlap.
    return (
      Math.min(ax, bx) <= Math.max(cx, dx) &&
      Math.min(cx, dx) <= Math.max(ax, bx) &&
      Math.min(ay, by) <= Math.max(cy, dy) &&
      Math.min(cy, dy) <= Math.max(ay, by)
    );
  }
  const d3 = cdx * (ay - cy) - cdy * (ax - cx);
  const d4 = cdx * (by - cy) - cdy * (bx - cx);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}
