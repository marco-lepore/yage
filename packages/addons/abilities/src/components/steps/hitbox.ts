import { Transform } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type { ColliderShape } from "@yagejs/physics";
import { defineStep } from "../../core/defineStep.js";
import {
  resolveAbilitySource,
  resolveAbilityTeam,
} from "../../core/AbilitySpawned.js";
import type { StepContext } from "../../core/types.js";
import { resolveHitSpec } from "../../core/hit/delivery.js";
import type { HitSpec } from "../../core/hit/delivery.js";
import { resolveAim } from "../aim.js";
import type { Aim } from "../aim.js";
import { HitReceiver } from "../HitReceiver.js";
import { createReportingDelivery } from "../reportedDelivery.js";
import { Hitbox } from "../../entities/Hitbox.js";

export interface HitboxParams {
  /** Collider shape in the +x facing-local frame; the body rotates it by the aim angle. */
  shape: ColliderShape;
  /** Local offset in the +x facing-local frame (px). Default (0,0). */
  offset?: Vec2Like;
  /** Firing direction; omit to read the caster's `Facing` (see `resolveAim`). */
  aim?: Aim;
  /** Team stamped into every hit; omit to inherit the caster's `HitReceiver.team`. */
  team?: string;
  /** Hit payload: static data or a fire-time builder, resolved once at `enter`. */
  hit: HitSpec;
  /** Tags stamped into every hit. */
  tags?: readonly string[];
  /** Physics collision-group passthrough; unset = member-of-all. */
  layers?: number;
  mask?: number;
  /** Re-anchors the hitbox to the caster's current position every frame
   *  instead of a fire-time snapshot; rotation and `offset` stay fixed at
   *  spawn. If the caster is destroyed mid-window, the hitbox keeps its
   *  last position. Default false. */
  follow?: boolean;
}

// Per-activation spawn ledger: ctx is unique per (entity, activation) and each
// step's `params` is unique in a timeline, so (ctx, params) identifies one
// open window. WeakMap-by-ctx releases when the activation ends.
const open = new WeakMap<StepContext, Map<object, Hitbox>>();

/**
 * A window during which a detached kinematic sensor hitbox is spawned in
 * front of the caster: `enter` spawns it, `exit` destroys it (whether the
 * window closed naturally or the ability was cancelled), so a swing can
 * never leave a stale hitbox behind. Delivers once per target for the
 * window's life. Concrete to `StandardHitData` — a per-system game writes
 * its own step calling `createHitDelivery<TData>`.
 */
export const hitbox = defineStep<HitboxParams>("hitbox", {
  enter(params, ctx) {
    const dir = resolveAim(params.aim, ctx); // throws on no aim + no Facing, or zero aim
    const transform = ctx.entity.tryGet(Transform);
    if (!transform) {
      throw new Error(
        `Abilities: step "hitbox" requires a Transform component on the entity.`,
      );
    }
    const from = transform.worldPosition;
    const team =
      params.team ??
      resolveAbilityTeam(ctx.entity) ??
      ctx.entity.tryGet(HitReceiver)?.team;
    const delivery = createReportingDelivery({
      source: resolveAbilitySource(ctx.entity),
      data: resolveHitSpec(params.hit, ctx),
      ...(team !== undefined ? { team } : {}),
      ...(params.tags ? { tags: params.tags } : {}),
    });
    const entity = ctx.entity.scene.spawn(Hitbox, {
      position: from,
      rotation: dir.angle(),
      shape: params.shape,
      ...(params.offset ? { offset: params.offset } : {}),
      delivery,
      groups: {
        ...(params.layers !== undefined ? { layers: params.layers } : {}),
        ...(params.mask !== undefined ? { mask: params.mask } : {}),
      },
      ...(params.follow ? { follow: true, caster: ctx.entity } : {}),
    });
    let byParams = open.get(ctx);
    if (!byParams) open.set(ctx, (byParams = new Map()));
    byParams.set(params, entity);
  },
  exit(params, ctx) {
    const byParams = open.get(ctx);
    const entity = byParams?.get(params);
    if (entity) {
      entity.destroy();
      byParams!.delete(params);
    }
  },
});
