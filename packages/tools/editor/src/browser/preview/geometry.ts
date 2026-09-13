import { Transform, type Entity, type Inspector } from "@yagejs/core";
import type { ColliderFacetSnapshot } from "@yagejs/physics";
import { VisualComponent } from "@yagejs/renderer";
import type { EditorPoint } from "../store/index.js";

/** A footprint in the caller’s coordinate space; polylines stay open. */
export interface PreviewOutline {
  readonly vertices: readonly EditorPoint[];
  readonly closed: boolean;
  readonly sensor: boolean;
}

export interface PreviewGeometry {
  readonly kind: "artwork" | "collider";
  readonly outlines: readonly PreviewOutline[];
}

/** The preview reads only plugin-owned component facts from Inspector. */
export type FacetReader = Pick<Inspector, "getComponentFacet">;

/** Artwork takes priority; empty visuals permit the collider fallback. */
export function geometryOf(
  entity: Entity,
  inspector?: FacetReader,
): PreviewGeometry {
  const artwork: PreviewOutline[] = [];
  for (const component of entity.getAll()) {
    if (!(component instanceof VisualComponent)) continue;
    const bounds = component.renderObject.getLocalBounds();
    const pivot = component.renderObject.pivot;
    artwork.push({
      vertices: rectangle(
        bounds.x - pivot.x,
        bounds.y - pivot.y,
        bounds.width,
        bounds.height,
      ),
      closed: true,
      sensor: false,
    });
  }
  if (artwork.some((outline) => hasArea(outline.vertices))) {
    return { kind: "artwork", outlines: artwork };
  }

  const colliders: PreviewOutline[] = [];
  for (const component of entity.getAll()) {
    const facet: ColliderFacetSnapshot | undefined =
      inspector?.getComponentFacet(component, "collider");
    if (!facet) continue;
    for (const outline of facet.outlines) {
      if (outline.vertices.length < 2) continue;
      colliders.push({ ...outline, sensor: facet.sensor });
    }
  }
  return colliders.length > 0
    ? { kind: "collider", outlines: colliders }
    : { kind: "artwork", outlines: artwork };
}

/** Apply the current Transform, including edits before the next render tick. */
export function worldGeometryOf(
  entity: Entity,
  inspector?: FacetReader,
): PreviewGeometry {
  const geometry = geometryOf(entity, inspector);
  const transform = entity.get(Transform);
  return {
    kind: geometry.kind,
    outlines: geometry.outlines.map((outline) => ({
      ...outline,
      vertices: outline.vertices.map((vertex) =>
        transform.localToWorld(vertex),
      ),
    })),
  };
}

function rectangle(
  x: number,
  y: number,
  width: number,
  height: number,
): EditorPoint[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function hasArea(vertices: readonly EditorPoint[]): boolean {
  const first = vertices[0];
  if (!first) return false;
  let twiceArea = 0;
  let extentSquared = 0;
  for (let i = 1; i < vertices.length; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const x = a.x - first.x;
    const y = a.y - first.y;
    twiceArea += x * (b.y - first.y) - y * (b.x - first.x);
    extentSquared = Math.max(extentSquared, x * x + y * y);
  }
  // A collapsed shape can retain rounding noise after a parent rotation.
  return Math.abs(twiceArea) > Number.EPSILON * extentSquared * vertices.length;
}

/** Closed footprints pick their interior; open segments use a screen-sized target. */
export function outlineContains(
  outline: PreviewOutline,
  point: EditorPoint,
  tolerance: number,
): boolean {
  const vertices = outline.vertices;
  const filled = outline.closed && hasArea(vertices);
  let inside = false;
  const count = outline.closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
            ),
          );
    if (
      Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <=
      (filled ? 1e-7 : tolerance)
    )
      return true;
    if (
      filled &&
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
