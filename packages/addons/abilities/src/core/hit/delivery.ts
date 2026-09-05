import { Transform, Vec2 } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import type { StepContext } from "../types.js";
import { Hittable } from "./types.js";
import type { Hit, HitResult, StandardHitData } from "./types.js";

/**
 * Authored hit data on a delivery step: static fields, or a builder resolved
 * once when the step fires (snapshot semantics — a projectile keeps its
 * resolved values even if the attacker's stats change or the attacker dies
 * mid-flight). Resolve with `resolveHitSpec` at fire time.
 */
export type HitSpec<TData = StandardHitData> =
  | TData
  | ((ctx: StepContext) => TData);

/** Resolve an authored `HitSpec` at fire time. */
export function resolveHitSpec<TData = StandardHitData>(
  spec: HitSpec<TData>,
  ctx: StepContext,
): TData {
  return typeof spec === "function"
    ? (spec as (ctx: StepContext) => TData)(ctx)
    : spec;
}

/**
 * Collision-group passthrough carried by every collider the addon creates
 * (hitbox, projectile, touch body). Left unset, the collider is a member of
 * all layers and sees all layers (Rapier's default), so every overlap
 * reaches the receiver-side team filter. Games with a collision-layer
 * scheme set both for physics-level pruning and own the mutual-mask wiring
 * (the engine warns on asymmetric masks in dev mode).
 */
export interface DeliveryColliderGroups {
  /** Collision layer membership bitmask. */
  layers?: number;
  /** Collision filter mask (which layers to interact with). */
  mask?: number;
}

export interface HitDeliveryOptions<TData = StandardHitData> {
  /** The attacking entity; it never receives this delivery's own hits. */
  source: Entity;
  /** Stamped into every payload; receivers reject same-team hits by default. */
  team?: string;
  tags?: readonly string[];
  /** Already-resolved hit data (see `resolveHitSpec`). Defaults to `{}`. */
  data?: TData;
}

/**
 * One fired delivery — a hitbox window, a projectile, or a touch-damage
 * interval — delivering the same resolved payload to each contact.
 */
export interface HitDelivery {
  /**
   * Deliver to one contact. `from` is the world-space position the hit comes
   * from (the hitbox owner or the projectile itself); the payload direction
   * is the unit vector from `from` to the target's position. Returns
   * `"ignored"` for destroyed targets, the delivery's own source and entities without the
   * `Hittable` trait; otherwise whatever the receiver decides.
   */
  deliver(target: Entity, from: Vec2Like): HitResult;
}

/** Create the delivery for one fired hit source (hitbox, projectile, touch). */
export function createHitDelivery<TData = StandardHitData>(
  options: HitDeliveryOptions<TData>,
): HitDelivery {
  const { source, team, tags = [] } = options;
  return {
    deliver(target, from) {
      if (target.isDestroyed) return "ignored";
      if (target === source) return "ignored";
      if (!target.hasTrait(Hittable)) return "ignored";
      const hit: Hit = {
        source,
        direction: directionTo(target, from),
        tags,
        // Shallow-copied per victim: a resolution stage may mutate
        // `hit.data` in place (a partial block halves `damage`), and a
        // single delivery reaches every contact in one tick — without the
        // copy, mutating victim A's payload would corrupt the def's own
        // data and leak into victim B. Cast at the same singleton boundary
        // as before: the `Hittable` trait is typed against the default
        // vocabulary, so per-system payloads travel as `StandardHitData`
        // here and receivers narrow them behind their own type guard.
        data: { ...(options.data ?? {}) } as StandardHitData,
        ...(team !== undefined ? { team } : {}),
      };
      return target.receiveHit(hit);
    },
  };
}

function directionTo(target: Entity, from: Vec2Like): Vec2 {
  const pos = target.tryGet(Transform)?.worldPosition;
  const direction = pos ? pos.sub(from).normalize() : Vec2.ZERO;
  // Coincident (or unknown) positions have no direction; +x keeps it unit.
  return direction.lengthSq() > 0 ? direction : new Vec2(1, 0);
}

/**
 * Default projectile consume rule; needs no collision-group setup. A
 * projectile is consumed by any non-`"ignored"` result — a landed hit or a
 * guard outcome (`"blocked"`/`"parried"`) both stop it, so a fully blocked
 * arrow is consumed by the shield instead of passing through — and by any
 * solid (non-sensor) contact, so walls stop it even when nothing receives
 * the hit, while sensor overlaps that don't land (pickup zones, triggers)
 * pass through. Games with a collision-layer scheme prune unwanted contacts
 * via the projectile collider's `layers`/`mask` instead.
 */
export function shouldConsumeProjectile(
  result: HitResult,
  otherIsSensor: boolean,
): boolean {
  return result !== "ignored" || !otherIsSensor;
}
