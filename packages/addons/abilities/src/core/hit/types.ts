import { defineTrait } from "@yagejs/core";
import type { Entity, Vec2 } from "@yagejs/core";

/**
 * The complete hit-resolution outcome vocabulary: `hit`/`ignored` are core's
 * (see `HitResult`); `blocked`/`parried` are the defaults layer's guard
 * outcomes (see `guard()` in the components layer). Declared together
 * because intra-package `declare module` augmentation does not survive
 * tsup's dts rollup (the `StandardHitData` precedent below) — a game
 * extending the outcome vocabulary widens `HitResult` at its own boundary
 * instead.
 */
export interface HitOutcomes {
  hit: true;
  ignored: true;
  blocked: true;
  parried: true;
}

/**
 * Outcome of delivering a hit to a receiver. `"ignored"` means the
 * receiver's policy rejected it (team filter, i-frames); `"blocked"`/
 * `"parried"` mean a `guard` step ended resolution (see `HitReceiver`'s
 * resolution fold). Delivery consumes a projectile on anything but
 * `"ignored"` (see `shouldConsumeProjectile`).
 */
export type HitResult = keyof HitOutcomes;

/**
 * The vocabulary read by the addon's default receipt steps
 * (`damageStep`/`reactionStep`). All optional — a receiver without `Health`
 * or `Stagger` skips the corresponding consequence. The delivery machinery
 * itself never reads these fields.
 */
export interface StandardHitData {
  /** HP subtracted via `Health.takeDamage`. */
  damage?: number;
  /** Peak knockback speed in px/s, decaying to zero across `stun`. */
  knockback?: number;
  /** Seconds of hit-stun driven by `Stagger`. */
  stun?: number;
  /**
   * Seconds of hitstop (freeze frame) an attacker may apply on landing this
   * hit. The delivery machinery never reads it — it is carried in the
   * `HitDealt` payload so an attacker's own listener can `SceneTime.freezeFor` it,
   * keeping the freeze duration declared next to the hit's damage numbers.
   */
  hitstop?: number;
}

/**
 * Where a hit touched its target, in world pixels. Present on hits whose
 * delivery could measure the contact: a `hitbox` or sensor `Projectile`
 * measures the sensor/target collider pair that fired the trigger, a solid
 * `Projectile` or `TouchDamage` body uses the collision's own contact, and
 * a manual `HitDelivery.deliver` passes what it knows. Absent when the
 * delivery had no collider pair to measure. A hitbox that starts its window
 * already overlapping the target reports a surface point from the current
 * overlap, not the first impact of an animated swing.
 */
export interface HitContact {
  /**
   * A point on the target collider's surface (for a solid collision, the
   * pair's deepest contact point).
   */
  readonly point: Vec2;
  /**
   * Unit normal of the target's surface at `point`, pointing out of the
   * target toward the attacking shape. Independent of `Hit.direction`, which
   * still runs from the delivery origin toward the target's position.
   */
  readonly normal: Vec2;
}

/**
 * The payload delivered to a `Hittable` receiver. `TData` types the `data`
 * field per combat system; the default is `StandardHitData`
 * (damage/knockback/stun). A game with one hit vocabulary extends it
 * directly and threads the type through every touchpoint that needs it:
 *
 * ```ts
 * interface MyHitData extends StandardHitData {
 *   pierce?: number;
 * }
 * new HitReceiver<MyHitData>({ ... });
 * createHitDelivery<MyHitData>({ ... });
 * ```
 *
 * A game running several combat systems with different hit-data shapes
 * gives each system its own interface with a discriminant field, typing its
 * touchpoints per system (`Hit<TData>`, `HitReceiver<TData>`,
 * `HitSpec<TData>`). The `Hittable` trait and the `HitReceived` event are
 * singleton tokens typed against the default, so each system pays one type
 * guard at its receipt boundary:
 *
 * ```ts
 * interface SpiritHitData { kind: "spirit"; pressure: number }
 * function isSpiritHit(hit: Hit<unknown>): hit is Hit<SpiritHitData> {
 *   return (hit.data as { kind?: string }).kind === "spirit";
 * }
 * ```
 *
 * Resolution stages may mutate `hit.data` in place (a partial block halves
 * `damage`) — see `HitStage`. The envelope fields below stay readonly.
 */
export interface Hit<TData = StandardHitData> {
  /** The attacking entity. Delivery never delivers a hit to its own source. */
  readonly source: Entity;
  /** Unit vector from the impact source position toward the victim. */
  readonly direction: Vec2;
  /** The attacker's team; receivers reject same-team hits by default. */
  readonly team?: string;
  /** Free-form labels for receivers and game handlers ("fire", "arrow"). */
  readonly tags: readonly string[];
  /** Vocabulary fields (see `StandardHitData`); never read by delivery. */
  readonly data: TData;
  /** Where the hit touched the target, when the delivery could measure it. */
  readonly contact?: HitContact;
}

/**
 * The receiver contract delivery looks for: anything that can be hit
 * declares this trait on its entity class. The common case delegates to a
 * `HitReceiver` component (see its docs); fully custom receivers (a torch
 * lit by fire hits) implement `receiveHit` directly:
 *
 * ```ts
 * @trait(Hittable)
 * class Torch extends Entity {
 *   receiveHit(hit: Hit): HitResult {
 *     if (!hit.tags.includes("fire")) return "ignored";
 *     this.light();
 *     return "hit";
 *   }
 * }
 * ```
 */
export const Hittable = defineTrait<{ receiveHit(hit: Hit): HitResult }>(
  "Hittable",
);
