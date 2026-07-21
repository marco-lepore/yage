import type { Vec2Like } from "@yagejs/core";
import type { ColliderShape } from "@yagejs/physics";
import type { StepContext, WindowStep } from "../../core/types.js";
import type { HitSpec } from "../../core/hit/delivery.js";
import type { StandardHitData } from "../../core/hit/types.js";
import {
  resolveAbilitySpawn,
  resolveAbilityTransform,
} from "../spawnResolution.js";
import type { Aim } from "../aim.js";
import { Hitbox } from "../../entities/Hitbox.js";

export interface HitboxParams<TData = StandardHitData> {
  /** Collider shape in the +x facing-local frame; the body rotates it by the aim angle. */
  shape: ColliderShape;
  /** Local offset in the +x facing-local frame (px). Default (0,0). */
  offset?: Vec2Like;
  /** Firing direction; omit to read the caster's `Facing` (see `resolveAim`). */
  aim?: Aim;
  /** Team stamped into every hit; omit to inherit the caster's `HitReceiver.team`. */
  team?: string;
  /** Hit payload: static data or a fire-time builder, resolved once at `enter`. */
  hit: HitSpec<TData>;
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

/** Arguments accepted by the typed hitbox-window factory. */
export type HitboxStepArgs<TData = StandardHitData> = HitboxParams<TData> & {
  from: number;
  to: number | "end";
  every?: number;
};

// Per-activation spawn ledger: ctx is unique per (entity, activation), and
// `Abilities`'s construction-time validator rejects the same step object
// appearing twice in one timeline, so (ctx, params) identifies one open
// window. WeakMap-by-ctx releases when the activation ends.
const open = new WeakMap<StepContext, Map<object, Hitbox>>();
const repeated = new WeakSet<object>();

/**
 * A window during which a detached kinematic sensor hitbox is spawned in
 * front of the caster: `enter` spawns it, `exit` destroys it (whether the
 * window closed naturally or the ability was cancelled), so a swing can
 * never leave a stale hitbox behind. Without `every`, it delivers once per
 * target for the window's life. With `every`, it delivers immediately on
 * contact and again to current overlaps at each interval. `TData` keeps
 * custom hit data typed through the fire-time builder and delivery.
 */
export function hitbox<TData = StandardHitData>(
  args: HitboxStepArgs<TData>,
): WindowStep<HitboxParams<TData>> {
  const { from, to, every, ...params } = args;
  const step: WindowStep<HitboxParams<TData>> = {
    kind: "hitbox",
    from,
    to,
    params,
    hooks: { enter: enterHitbox, exit: exitHitbox, tick: repeatHitbox },
  };
  if (every !== undefined) {
    step.every = every;
    repeated.add(params);
  }
  return step;
}

function repeatHitbox<TData>(
  params: HitboxParams<TData>,
  ctx: StepContext,
): void {
  open.get(ctx)?.get(params)?.repeatHits();
}

function enterHitbox<TData>(
  params: HitboxParams<TData>,
  ctx: StepContext,
): void {
  const resolved = resolveAbilitySpawn<TData>({
    ctx,
    ...(params.aim !== undefined ? { aim: params.aim } : {}),
    ...(params.team !== undefined ? { team: params.team } : {}),
    hit: params.hit,
    ...(params.tags ? { tags: params.tags } : {}),
  });
  // `hit` is required on `HitboxParams`, so `resolveAbilitySpawn` always
  // resolves a delivery here.
  const delivery = resolved.delivery!;
  const entity = ctx.entity.scene.spawn(Hitbox, {
    position: resolveAbilityTransform(ctx, "hitbox").worldPosition,
    rotation: resolved.aim.angle(),
    shape: params.shape,
    ...(params.offset ? { offset: params.offset } : {}),
    delivery,
    groups: {
      ...(params.layers !== undefined ? { layers: params.layers } : {}),
      ...(params.mask !== undefined ? { mask: params.mask } : {}),
    },
    ...(params.follow ? { follow: true, caster: ctx.entity } : {}),
  });
  if (repeated.has(params)) entity.enableRepeatHits();
  let byParams = open.get(ctx);
  if (!byParams) open.set(ctx, (byParams = new Map()));
  byParams.set(params, entity);
}

function exitHitbox<TData>(
  params: HitboxParams<TData>,
  ctx: StepContext,
): void {
  const byParams = open.get(ctx);
  const entity = byParams?.get(params);
  if (entity) {
    entity.destroy();
    byParams!.delete(params);
  }
}
