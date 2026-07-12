import { defineStep } from "../../core/defineStep.js";
import { HitReceiver } from "../HitReceiver.js";
import type { GuardParams } from "../HitReceiver.js";

/**
 * A window during which its `policy` evaluates every incoming hit against
 * this entity's `HitReceiver` (team → i-frames → guards → apply — see
 * `HitReceiver`'s resolution fold). `outcome` labels the `HitResult` this
 * guard reports when it engages ("blocked", "parried", ...); a held block
 * is the same step with an open-ended window on a channeled ability.
 * Concrete to `StandardHitData` — a per-system receiver with its own
 * `TData` supplies its own guard stage via `HitReceiverOptions.steps`.
 */
export const guard = defineStep<GuardParams>("guard", {
  enter(params, ctx) {
    const receiver = ctx.entity.tryGet(HitReceiver);
    if (!receiver) {
      throw new Error(
        `Abilities: step "guard" requires a HitReceiver component on the entity.`,
      );
    }
    receiver.openGuard(params);
  },
  exit(params, ctx) {
    const receiver = ctx.entity.tryGet(HitReceiver);
    if (!receiver) {
      throw new Error(
        `Abilities: step "guard" requires a HitReceiver component on the entity.`,
      );
    }
    receiver.closeGuard(params);
  },
});
