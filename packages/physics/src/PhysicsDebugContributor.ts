import type { DebugContributor, WorldDebugApi } from "@yagejs/debug/api";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";

/** Rapier ShapeType enum values. */
const ShapeType = { Ball: 0, Cuboid: 1, Capsule: 2 } as const;

const COLOR_DYNAMIC = 0x00ff00;
const COLOR_KINEMATIC = 0x4488ff;
const COLOR_STATIC = 0x888888;
const COLOR_SENSOR = 0xffff00;

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

        const color = this.getColliderColor(collider);

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
        }
      }
    }
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
