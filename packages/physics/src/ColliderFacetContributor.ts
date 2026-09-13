import type {
  Component,
  InspectorFacetContributor,
  Vec2Like,
} from "@yagejs/core";
import { ColliderComponent } from "./ColliderComponent.js";
import { colliderOutline } from "./colliderGeometry.js";
import { colliderParts } from "./colliderParts.js";

/** An authored collider footprint in entity-local pixels, before Transform. */
export interface ColliderOutlineSnapshot {
  readonly vertices: readonly Vec2Like[];
  /** False for an open polyline; true for a filled footprint. */
  readonly closed: boolean;
}

/** Authored geometry, available while a collider is dormant or detached. */
export interface ColliderFacetSnapshot {
  readonly sensor: boolean;
  readonly outlines: readonly ColliderOutlineSnapshot[];
}

declare module "@yagejs/core" {
  interface InspectorFacets {
    /** Authored collider footprints contributed by @yagejs/physics. */
    collider?: ColliderFacetSnapshot;
  }
}

/** @internal Physics owns collider interpretation; no Rapier state is read. */
export class ColliderFacetContributor implements InspectorFacetContributor {
  readonly namespace = "collider";

  inspectComponent(component: Component): ColliderFacetSnapshot | undefined {
    if (!(component instanceof ColliderComponent)) return undefined;
    return {
      sensor: component.config.sensor === true,
      outlines: colliderParts(component.config).map((part) => {
        const vertices = colliderOutline(part);
        return {
          vertices:
            part.shape.type === "polygon" ? convexHull(vertices) : vertices,
          closed: part.shape.type !== "polyline",
        };
      }),
    };
  }
}

/** Rapier interprets polygon vertices as a convex hull, including concave input. */
function convexHull(vertices: readonly Vec2Like[]): readonly Vec2Like[] {
  const sorted = [...vertices].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (points: readonly Vec2Like[]): Vec2Like[] => {
    const hull: Vec2Like[] = [];
    for (const point of points) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]!;
        const b = hull[hull.length - 1]!;
        if ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) > 0)
          break;
        hull.pop();
      }
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}
