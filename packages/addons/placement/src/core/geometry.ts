import type { PlacementPose, PlacementRect } from "./types.js";

export function finite(value: number, path: string): void {
  if (!Number.isFinite(value))
    throw new Error(
      `Placement.${path}: expected a finite number, got ${value}`,
    );
}

export function pose(value: PlacementPose, path: string): void {
  finite(value.x, `${path}.x`);
  finite(value.y, `${path}.y`);
  finite(value.rotation, `${path}.rotation`);
}

export function rect(value: PlacementRect, path: string): void {
  for (const key of ["x", "y", "width", "height"] as const)
    finite(value[key], `${path}.${key}`);
  if (value.width <= 0 || value.height <= 0)
    throw new Error(`Placement.${path}: width and height must be positive`);
  finite(value.x + value.width, `${path}.right`);
  finite(value.y + value.height, `${path}.bottom`);
}

export function compose(
  parent: PlacementPose,
  local: PlacementPose,
): PlacementPose {
  const c = Math.cos(parent.rotation),
    s = Math.sin(parent.rotation);
  const result = {
    x: parent.x + local.x * c - local.y * s,
    y: parent.y + local.x * s + local.y * c,
    rotation: parent.rotation + local.rotation,
  };
  pose(result, "compose");
  return result;
}

export function relative(
  parent: PlacementPose,
  world: PlacementPose,
): PlacementPose {
  const dx = world.x - parent.x,
    dy = world.y - parent.y;
  const c = Math.cos(parent.rotation),
    s = Math.sin(parent.rotation);
  const result = {
    x: dx * c + dy * s,
    y: -dx * s + dy * c,
    rotation: world.rotation - parent.rotation,
  };
  pose(result, "relative");
  return result;
}

export function corners(
  box: PlacementRect,
  at: PlacementPose,
  padding = 0,
): PlacementPose[] {
  const x = box.x - padding,
    y = box.y - padding;
  const r = box.x + box.width + padding,
    b = box.y + box.height + padding;
  return [
    [x, y],
    [r, y],
    [r, b],
    [x, b],
  ].map(([px, py]) => compose(at, { x: px!, y: py!, rotation: 0 }));
}

/** Touching edges are allowed; polygons are convex rectangles. */
export function overlaps(
  a: readonly PlacementPose[],
  b: readonly PlacementPose[],
): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!,
        q = polygon[(i + 1) % polygon.length]!;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const nx = -(q.y - p.y) / length,
        ny = (q.x - p.x) / length;
      const project = (v: readonly PlacementPose[]): number[] =>
        v.map((v) => (v.x - p.x) * nx + (v.y - p.y) * ny);
      const pa = project(a),
        pb = project(b);
      if (
        Math.max(...pa) <= Math.min(...pb) + 1e-7 ||
        Math.max(...pb) <= Math.min(...pa) + 1e-7
      )
        return false;
    }
  }
  return true;
}

export function inside(
  points: readonly PlacementPose[],
  bounds: PlacementRect,
): boolean {
  return points.every(
    (p) =>
      p.x >= bounds.x - 1e-7 &&
      p.y >= bounds.y - 1e-7 &&
      p.x <= bounds.x + bounds.width + 1e-7 &&
      p.y <= bounds.y + bounds.height + 1e-7,
  );
}

export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function copy<T>(value: T): T {
  return structuredClone(value);
}
