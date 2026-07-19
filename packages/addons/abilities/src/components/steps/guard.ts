import { defineStep } from "../../core/defineStep.js";
import { HitReceiver } from "../HitReceiver.js";
import type { GuardParams } from "../HitReceiver.js";
import type { WindowStep } from "../../core/types.js";
import type { StandardHitData } from "../../core/hit/types.js";

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

/**
 * Full-negate guard tuned for a parry: engages on every incoming hit, ends
 * resolution with the `"parried"` outcome, and optionally delivers `punish`
 * hit data back to the attacker. Equivalent to a `guard()` window with an
 * always-negate policy.
 */
export function parry(args: {
  from: number;
  to: number;
  punish?: StandardHitData;
}): WindowStep<GuardParams> {
  return guard({
    from: args.from,
    to: args.to,
    outcome: "parried",
    policy: () => "negate",
    ...(args.punish !== undefined ? { punish: args.punish } : {}),
  });
}

/**
 * Partial guard tuned for a held block: scales each incoming hit's
 * `damage`/`knockback`/`stun` in place and lets it land (result stays
 * `"hit"`, so i-frames arm), reporting the `"blocked"` outcome to
 * `HitGuarded`. Scales default to 0, so a bare `block()` fully mitigates;
 * pass a fraction to let that share of a consequence through. `stunScale`
 * defaults to 0 so a blocked hit never triggers the stagger reaction unless
 * the game opts in.
 */
export function block(args: {
  from: number;
  to: number | "end";
  damageScale?: number;
  knockbackScale?: number;
  stunScale?: number;
}): WindowStep<GuardParams> {
  const damageScale = args.damageScale ?? 0;
  const knockbackScale = args.knockbackScale ?? 0;
  const stunScale = args.stunScale ?? 0;
  return guard({
    from: args.from,
    to: args.to,
    outcome: "blocked",
    policy: (hit) => {
      hit.data.damage = (hit.data.damage ?? 0) * damageScale;
      hit.data.knockback = (hit.data.knockback ?? 0) * knockbackScale;
      hit.data.stun = (hit.data.stun ?? 0) * stunScale;
      return "modified";
    },
  });
}
