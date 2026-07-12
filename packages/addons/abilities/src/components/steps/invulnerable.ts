import { defineStep } from "../../core/defineStep.js";
import { HitReceiver } from "../HitReceiver.js";

/**
 * A window of full invulnerability on this entity's `HitReceiver` — every
 * hit is ignored regardless of team or guards. This IS dodge:
 * `invulnerable({ from, to })` generalizes a hand-rolled i-frame slot.
 * Distinct from the timed i-frames a `HitReceiver` arms automatically after
 * a landed hit — that gate stacks with this one (either being active
 * ignores the hit). Windows are keyed by step identity, so overlapping
 * windows keep the entity protected until the last one closes.
 */
export const invulnerable = defineStep<object>("invulnerable", {
  enter: (params, ctx) => {
    const receiver = ctx.entity.tryGet(HitReceiver);
    if (!receiver) {
      throw new Error(
        `Abilities: step "invulnerable" requires a HitReceiver component on the entity.`,
      );
    }
    receiver.openInvulnerability(params);
  },
  exit: (params, ctx) => {
    const receiver = ctx.entity.tryGet(HitReceiver);
    if (!receiver) {
      throw new Error(
        `Abilities: step "invulnerable" requires a HitReceiver component on the entity.`,
      );
    }
    receiver.closeInvulnerability(params);
  },
});
