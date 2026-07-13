// Type-only: erased at build time, same reasoning as tilemap.ts's import of
// `@yagejs/tilemap` — this module never runs tilemap code, only reads its
// shape-config field layout.
import type {
  CapsuleColliderConfig,
  CircleColliderConfig,
  RectColliderConfig,
  TilemapColliderConfig,
} from "@yagejs/tilemap";

/**
 * Cell-vs-shape overlap tests behind `gridFromColliders`. Every test treats a
 * shared boundary (a shape's edge landing exactly on a cell edge) as
 * overlap — a shape "grazing" a cell blocks it. Not part of the package's
 * public API.
 */

interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Rotates `(dx, dy)` by `angle` (radians) about the origin. */
function rotate(
  dx: number,
  dy: number,
  angle: number,
): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** The four corners of a rect, rotated about its own `(x, y)` pivot. */
function rectCorners(rect: RectColliderConfig): { x: number; y: number }[] {
  const local = [
    { x: 0, y: 0 },
    { x: rect.width, y: 0 },
    { x: rect.width, y: rect.height },
    { x: 0, y: rect.height },
  ];
  const angle = rect.rotation ?? 0;
  if (angle === 0) {
    return local.map((p) => ({ x: rect.x + p.x, y: rect.y + p.y }));
  }
  return local.map((p) => {
    const r = rotate(p.x, p.y, angle);
    return { x: rect.x + r.x, y: rect.y + r.y };
  });
}

/** World-space center of a circle's bounding box. */
function circleCenter(circle: CircleColliderConfig): { x: number; y: number } {
  return { x: circle.x + circle.width / 2, y: circle.y + circle.height / 2 };
}

/**
 * The capsule's core segment endpoints — the line whose Minkowski sum with a
 * disc of `radius` forms the capsule. Runs along `axis` through the bounding
 * box's center, then rotates about the `(x, y)` pivot like a rect.
 */
function capsuleSegment(
  capsule: CapsuleColliderConfig,
): [number, number, number, number] {
  const centerX = capsule.width / 2;
  const centerY = capsule.height / 2;
  const half = capsule.halfHeight;
  const [ax, ay, bx, by] =
    capsule.axis === "y"
      ? [centerX, centerY - half, centerX, centerY + half]
      : [centerX - half, centerY, centerX + half, centerY];

  const angle = capsule.rotation ?? 0;
  if (angle === 0) {
    return [capsule.x + ax, capsule.y + ay, capsule.x + bx, capsule.y + by];
  }
  const a = rotate(ax, ay, angle);
  const b = rotate(bx, by, angle);
  return [capsule.x + a.x, capsule.y + a.y, capsule.x + b.x, capsule.y + b.y];
}

/** World-space vertices of a polygon/polyline shape (local offsets from `(x, y)`). */
function worldVertices(shape: {
  x: number;
  y: number;
  vertices: { x: number; y: number }[];
}): {
  x: number;
  y: number;
}[] {
  return shape.vertices.map((v) => ({ x: shape.x + v.x, y: shape.y + v.y }));
}

/**
 * Axis-aligned bounds of `shape`, in the same map-local px space as its
 * coordinates. Used only to size the candidate-cell iteration window — the
 * exact per-cell tests below decide actual overlap.
 */
export function shapeAabb(shape: TilemapColliderConfig): Aabb {
  switch (shape.type) {
    case "rect": {
      const corners = rectCorners(shape);
      return {
        minX: Math.min(...corners.map((c) => c.x)),
        minY: Math.min(...corners.map((c) => c.y)),
        maxX: Math.max(...corners.map((c) => c.x)),
        maxY: Math.max(...corners.map((c) => c.y)),
      };
    }
    case "circle": {
      const center = circleCenter(shape);
      return {
        minX: center.x - shape.radius,
        minY: center.y - shape.radius,
        maxX: center.x + shape.radius,
        maxY: center.y + shape.radius,
      };
    }
    case "capsule": {
      const [x1, y1, x2, y2] = capsuleSegment(shape);
      return {
        minX: Math.min(x1, x2) - shape.radius,
        minY: Math.min(y1, y2) - shape.radius,
        maxX: Math.max(x1, x2) + shape.radius,
        maxY: Math.max(y1, y2) + shape.radius,
      };
    }
    case "polygon":
    case "polyline": {
      const verts = worldVertices(shape);
      return {
        minX: Math.min(...verts.map((v) => v.x)),
        minY: Math.min(...verts.map((v) => v.y)),
        maxX: Math.max(...verts.map((v) => v.x)),
        maxY: Math.max(...verts.map((v) => v.y)),
      };
    }
  }
}

/**
 * Whether the segment `(x1,y1)-(x2,y2)` intersects the closed rect
 * `[minX,maxX] x [minY,maxY]`, including a segment fully inside the rect and
 * one that only touches an edge. Liang-Barsky clipping: shrinks the
 * parameter range `[t0,t1]` against each of the rect's four half-plane
 * boundaries; a non-empty range at the end means some point of the segment
 * lies in the rect.
 */
function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];

  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return false; // parallel to this boundary and outside it
      continue;
    }
    const r = qi / pi;
    if (pi < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/** Squared distance between segments `(p1,p2)` and `(q1,q2)`. */
function segmentSegmentDistanceSq(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  q1x: number,
  q1y: number,
  q2x: number,
  q2y: number,
): number {
  const EPS = 1e-12;
  const d1x = p2x - p1x;
  const d1y = p2y - p1y;
  const d2x = q2x - q1x;
  const d2y = q2y - q1y;
  const rx = p1x - q1x;
  const ry = p1y - q1y;

  const a = d1x * d1x + d1y * d1y; // squared length of segment p
  const e = d2x * d2x + d2y * d2y; // squared length of segment q
  const f = d2x * rx + d2y * ry;

  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const cx = p1x + s * d1x - (q1x + t * d2x);
  const cy = p1y + s * d1y - (q1y + t * d2y);
  return cx * cx + cy * cy;
}

/** Even-odd ray-cast point-in-polygon test; correct for concave outlines. */
function pointInPolygon(
  px: number,
  py: number,
  verts: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const vi = verts[i]!;
    const vj = verts[j]!;
    const crosses = vi.y > py !== vj.y > py;
    if (crosses && px < ((vj.x - vi.x) * (py - vi.y)) / (vj.y - vi.y) + vi.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Whether shape `a`'s corners, projected onto axis `(ax, ay)`, overlap shape `b`'s. */
function axisOverlaps(
  a: { x: number; y: number }[],
  b: { x: number; y: number }[],
  ax: number,
  ay: number,
): boolean {
  let aMin = Infinity;
  let aMax = -Infinity;
  for (const p of a) {
    const proj = p.x * ax + p.y * ay;
    if (proj < aMin) aMin = proj;
    if (proj > aMax) aMax = proj;
  }
  let bMin = Infinity;
  let bMax = -Infinity;
  for (const p of b) {
    const proj = p.x * ax + p.y * ay;
    if (proj < bMin) bMin = proj;
    if (proj > bMax) bMax = proj;
  }
  return aMin <= bMax && aMax >= bMin;
}

/** Whether an OBB (given its 4 world-space corners) overlaps a closed AABB rect. */
function obbOverlapsRect(
  corners: { x: number; y: number }[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const rectCornerPts = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  // 2 world axes, then the OBB's 2 edge normals (its own local x/y axes,
  // since it's a rectangle — parallel edges share one axis each).
  const e1x = corners[1]!.x - corners[0]!.x;
  const e1y = corners[1]!.y - corners[0]!.y;
  const e2x = corners[3]!.x - corners[0]!.x;
  const e2y = corners[3]!.y - corners[0]!.y;
  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
    [e1x, e1y],
    [e2x, e2y],
  ];
  return axes.every(([ax, ay]) => axisOverlaps(corners, rectCornerPts, ax, ay));
}

/** Whether `shape` overlaps the closed cell rect `[minX,maxX] x [minY,maxY]`. */
export function shapeOverlapsCell(
  shape: TilemapColliderConfig,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  switch (shape.type) {
    case "rect": {
      if (!shape.rotation) {
        return (
          shape.x <= maxX &&
          shape.x + shape.width >= minX &&
          shape.y <= maxY &&
          shape.y + shape.height >= minY
        );
      }
      return obbOverlapsRect(rectCorners(shape), minX, minY, maxX, maxY);
    }
    case "circle": {
      const center = circleCenter(shape);
      const cx = clamp(center.x, minX, maxX);
      const cy = clamp(center.y, minY, maxY);
      const dx = center.x - cx;
      const dy = center.y - cy;
      return dx * dx + dy * dy <= shape.radius * shape.radius;
    }
    case "capsule": {
      const [x1, y1, x2, y2] = capsuleSegment(shape);
      if (segmentIntersectsRect(x1, y1, x2, y2, minX, minY, maxX, maxY))
        return true;
      const edges: [number, number, number, number][] = [
        [minX, minY, maxX, minY],
        [maxX, minY, maxX, maxY],
        [maxX, maxY, minX, maxY],
        [minX, maxY, minX, minY],
      ];
      const radiusSq = shape.radius * shape.radius;
      return edges.some(
        ([ex1, ey1, ex2, ey2]) =>
          segmentSegmentDistanceSq(x1, y1, x2, y2, ex1, ey1, ex2, ey2) <=
          radiusSq,
      );
    }
    case "polygon": {
      return polygonOverlapsRect(worldVertices(shape), minX, minY, maxX, maxY);
    }
    case "polyline": {
      const verts = worldVertices(shape);
      // A closed chain (first vertex repeated at the end — the shape a Tiled
      // Polygon-tool object extracts as) is a region: fill its interior. An
      // open chain is a thin wall: only crossed cells block.
      const first = verts[0];
      const last = verts[verts.length - 1];
      if (
        verts.length > 3 &&
        first &&
        last &&
        first.x === last.x &&
        first.y === last.y
      ) {
        return polygonOverlapsRect(verts.slice(0, -1), minX, minY, maxX, maxY);
      }
      for (let i = 0; i < verts.length - 1; i++) {
        const a = verts[i]!;
        const b = verts[i + 1]!;
        if (segmentIntersectsRect(a.x, a.y, b.x, b.y, minX, minY, maxX, maxY))
          return true;
      }
      return false;
    }
  }
}

/** Filled-outline overlap: any edge crosses the rect, or the rect sits
 *  inside the outline, or the outline sits inside the rect. Concave-safe. */
function polygonOverlapsRect(
  verts: { x: number; y: number }[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    if (segmentIntersectsRect(a.x, a.y, b.x, b.y, minX, minY, maxX, maxY))
      return true;
  }
  const rectCornerPts = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  if (rectCornerPts.some((c) => pointInPolygon(c.x, c.y, verts))) return true;
  return verts.some(
    (v) => v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY,
  );
}
