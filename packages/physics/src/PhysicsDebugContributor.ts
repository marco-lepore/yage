import type {
  DebugContributor,
  DebugGraphics,
  WorldDebugApi,
} from "@yagejs/debug/api";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";
import { colliderRotation } from "./colliderGeometry.js";
import type { ColliderConfig } from "./types.js";

/** Rapier ShapeType enum values (mirrored to avoid pulling the wasm runtime). */
const ShapeType = {
  Ball: 0,
  Cuboid: 1,
  Capsule: 2,
  ConvexPolygon: 9,
  RoundCuboid: 10,
} as const;

const COLOR_DYNAMIC = 0x00ff00;
const COLOR_KINEMATIC = 0x4488ff;
const COLOR_STATIC = 0x888888;
const COLOR_SENSOR = 0xffff00;
const COLOR_ONE_WAY = 0xff8800;

/** Debug contributor that draws physics collider wireframes. */
export class PhysicsDebugContributor implements DebugContributor {
  readonly name = "physics";
  readonly flags = ["shapes", "velocities"] as const;

  constructor(private readonly manager: PhysicsWorldManager) {}

  drawWorld(api: WorldDebugApi): void {
    if (!api.isFlagEnabled("shapes")) return;

    for (const [, ctx] of this.manager.getAllContexts()) {
      const world = ctx.world;
      const ppm = world.pixelsPerMeter;

      for (const handle of world.colliderMap.keys()) {
        const collider = world.getCollider(handle);
        if (!collider) continue;

        const g = api.acquireGraphics();
        if (!g) return; // pool exhausted

        const component = world._colliderComponents.get(handle);
        const config = component?.config;
        // One-way visuals only while the active filter is still the one
        // `config.oneWay` installed — a custom filter set over the preset
        // changes the behavior, so it must not keep the one-way look.
        const oneWayActive =
          component?._oneWayFilterActive === true &&
          config?.oneWay !== undefined;
        const color = oneWayActive
          ? COLOR_ONE_WAY
          : this.getColliderColor(collider);

        const pos = collider.translation();
        g.position.x = pos.x * ppm;
        g.position.y = pos.y * ppm;
        g.rotation = collider.rotation();

        const alpha = collider.isSensor() ? 0.3 : 0.5;
        const strokeStyle = { width: 1 / api.cameraZoom, color, alpha };

        switch (collider.shapeType()) {
          case ShapeType.Ball: {
            const r = collider.radius() * ppm;
            g.circle(0, 0, r).stroke(strokeStyle);
            break;
          }
          case ShapeType.Cuboid: {
            const he = collider.halfExtents();
            const hw = he.x * ppm;
            const hh = he.y * ppm;
            g.rect(-hw, -hh, hw * 2, hh * 2).stroke(strokeStyle);
            break;
          }
          case ShapeType.RoundCuboid: {
            // halfExtents() is the inner box; the border radius is added back
            // on every side to recover the outer footprint.
            const he = collider.halfExtents();
            const radius = collider.roundRadius() * ppm;
            const hw = he.x * ppm + radius;
            const hh = he.y * ppm + radius;
            g.roundRect(-hw, -hh, hw * 2, hh * 2, radius).stroke(strokeStyle);
            break;
          }
          case ShapeType.Capsule: {
            const r = collider.radius() * ppm;
            const hh = collider.halfHeight() * ppm;
            g.circle(0, -hh, r)
              .circle(0, hh, r)
              .moveTo(-r, -hh)
              .lineTo(-r, hh)
              .moveTo(r, -hh)
              .lineTo(r, hh)
              .stroke(strokeStyle);
            break;
          }
          case ShapeType.ConvexPolygon: {
            // vertices() yields a flat Float32Array of (x, y) pairs in
            // meter-space. Trace the hull and close it. The even-length
            // check makes the invariant explicit — an odd count would
            // silently produce NaN coordinates on the trailing read.
            const verts = collider.vertices();
            if (verts.length >= 4 && verts.length % 2 === 0) {
              g.moveTo(verts[0]! * ppm, verts[1]! * ppm);
              for (let i = 2; i < verts.length; i += 2) {
                g.lineTo(verts[i]! * ppm, verts[i + 1]! * ppm);
              }
              g.lineTo(verts[0]! * ppm, verts[1]! * ppm).stroke(strokeStyle);
            }
            break;
          }
        }

        if (oneWayActive && config) {
          this.drawOneWayArrow(g, config, strokeStyle);
        }
      }
    }
  }

  /**
   * Arrow from the collider center toward the solid side of a one-way
   * platform. The graphics node already carries the collider's world
   * rotation, so the body-local direction is rotated back by the collider's
   * rotation relative to its body.
   */
  private drawOneWayArrow(
    g: DebugGraphics,
    config: ColliderConfig,
    strokeStyle: { width: number; color: number; alpha?: number },
  ): void {
    const dir = config.oneWay?.direction ?? { x: 0, y: -1 };
    const len = Math.hypot(dir.x, dir.y);
    if (len === 0) return;

    const rel = colliderRotation(config);
    const cos = Math.cos(rel);
    const sin = Math.sin(rel);
    const dx = (dir.x * cos + dir.y * sin) / len;
    const dy = (-dir.x * sin + dir.y * cos) / len;

    const length = 20;
    const tipX = dx * length;
    const tipY = dy * length;
    const headSize = 6;
    // Perpendicular for the two arrowhead strokes.
    const px = -dy;
    const py = dx;
    g.moveTo(0, 0);
    g.lineTo(tipX, tipY);
    g.moveTo(tipX, tipY);
    g.lineTo(
      tipX + (px - dx) * headSize * 0.5,
      tipY + (py - dy) * headSize * 0.5,
    );
    g.moveTo(tipX, tipY);
    g.lineTo(
      tipX + (-px - dx) * headSize * 0.5,
      tipY + (-py - dy) * headSize * 0.5,
    ).stroke(strokeStyle);
  }

  private getColliderColor(collider: {
    isSensor(): boolean;
    parent(): { isDynamic(): boolean; isKinematic(): boolean } | null;
  }): number {
    if (collider.isSensor()) return COLOR_SENSOR;
    const body = collider.parent();
    if (body?.isDynamic()) return COLOR_DYNAMIC;
    if (body?.isKinematic()) return COLOR_KINEMATIC;
    return COLOR_STATIC;
  }
}
