import { Transform, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type { ColliderShape } from "@yagejs/physics";
import { defineStep } from "../../core/defineStep.js";
import { resolveHitSpec } from "../../core/hit/delivery.js";
import type { HitSpec } from "../../core/hit/delivery.js";
import { resolveAim } from "../aim.js";
import type { Aim } from "../aim.js";
import { HitReceiver } from "../HitReceiver.js";
import { createReportingDelivery } from "../reportedDelivery.js";
import { Projectile } from "../../entities/Projectile.js";

export interface ProjectileParams {
  /** Collider shape. Default `{ type: "circle", radius: 4 }`. */
  shape?: ColliderShape;
  /** Speed px/s. */
  speed: number;
  /** Seconds before self-destruct. */
  lifetime: number;
  /** Firing direction; omit to read the caster's `Facing` (see `resolveAim`). */
  aim?: Aim;
  /** Team stamped into every hit; omit to inherit the caster's `HitReceiver.team`. */
  team?: string;
  /** Hit payload: static data or a fire-time builder, resolved once at `fire`. */
  hit: HitSpec;
  /** Tags stamped into every hit. */
  tags?: readonly string[];
  /** Spawn offset in the +x facing-local frame (px), rotated by aim. */
  offset?: Vec2Like;
  /** Physics collision-group passthrough; unset = member-of-all. */
  layers?: number;
  mask?: number;
}

/**
 * Spawns a `Projectile` with the hit resolved at fire time (snapshot
 * semantics — the caster turning or dying mid-flight doesn't change the
 * hit). Concrete to `StandardHitData` — a per-system game writes its own
 * step calling `createHitDelivery<TData>`.
 */
export const projectile = defineStep<ProjectileParams>("projectile", {
  fire(params, ctx) {
    const dir = resolveAim(params.aim, ctx);
    const transform = ctx.entity.tryGet(Transform);
    if (!transform) {
      throw new Error(
        `Abilities: step "projectile" requires a Transform component on the entity.`,
      );
    }
    const casterPos = transform.worldPosition;
    const spawnPos = params.offset
      ? casterPos.add(new Vec2(params.offset.x, params.offset.y).rotate(dir.angle()))
      : casterPos;
    const team = params.team ?? ctx.entity.tryGet(HitReceiver)?.team;
    const delivery = createReportingDelivery({
      source: ctx.entity,
      data: resolveHitSpec(params.hit, ctx),
      ...(team !== undefined ? { team } : {}),
      ...(params.tags ? { tags: params.tags } : {}),
    });
    ctx.entity.scene.spawn(Projectile, {
      position: spawnPos,
      direction: dir,
      speed: params.speed,
      shape: params.shape ?? { type: "circle", radius: 4 },
      delivery,
      owner: ctx.entity,
      lifetime: params.lifetime,
      groups: {
        ...(params.layers !== undefined ? { layers: params.layers } : {}),
        ...(params.mask !== undefined ? { mask: params.mask } : {}),
      },
    });
  },
});
