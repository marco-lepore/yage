import { Abilities } from "../core/Abilities.js";
import { Health } from "./Health.js";
import { Stagger } from "./Stagger.js";
import { staggerReaction } from "./steps/stagger.js";
import type { HitReceiver } from "./HitReceiver.js";
import type { HitStage } from "../core/hit/resolve.js";
import type { StandardHitData } from "../core/hit/types.js";

type StandardHitStage = HitStage<StandardHitData, HitReceiver<StandardHitData>>;

/** Applies `damage` through the entity's `Health`, if present. */
export const damageStep: StandardHitStage = (hit, receiver) => {
  const damage = hit.data.damage ?? 0;
  if (damage <= 0) return;
  receiver.entity.tryGet(Health)?.takeDamage(damage);
};

/**
 * Forces the built-in stagger reaction from `knockback`/`stun` through the
 * entity's `Abilities`, if present, so it arbitrates against whatever else
 * the entity is doing (see `staggerReaction`). Falls back to driving a
 * sibling `Stagger` directly when there's no `Abilities` — a receiver
 * without one is a dumb flinching target and works with no arbitration.
 */
export const reactionStep: StandardHitStage = (hit, receiver) => {
  const knockback = hit.data.knockback ?? 0;
  const stun = hit.data.stun ?? 0;
  if (stun <= 0) return;
  // Ordered after the damage step: a killing blow must not shove the corpse
  // around while the death animation plays.
  if (receiver.entity.tryGet(Health)?.isDead) return;
  const abilities = receiver.entity.tryGet(Abilities);
  if (abilities) {
    abilities.force(
      staggerReaction({ direction: hit.direction, knockback, stun }),
    );
  } else {
    receiver.entity
      .tryGet(Stagger)
      ?.begin({ direction: hit.direction, knockback, stun });
  }
};

/**
 * The default apply-stage sequence: damage, then reaction. The order is
 * load-bearing — see `reactionStep`.
 */
export const defaultHitSteps: readonly StandardHitStage[] = [
  damageStep,
  reactionStep,
];
