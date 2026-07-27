import { defineStep } from "../../core/defineStep.js";
import type { StepContext } from "../../core/types.js";
import { HitReceiver } from "../HitReceiver.js";

// Per-run open-window key: `ctx` is unique per (entity, activation), and
// `Abilities`'s construction-time validator rejects the same step object
// appearing twice in one timeline, so (ctx, params) identifies one open
// window — mirrors `hitbox`'s spawn ledger. A fresh key object per entry
// (rather than keying `HitReceiver.openInvulnerability` by `params` itself)
// keeps two concurrent lanes that happen to reuse the same step object (a
// game sharing one `invulnerable(...)` value across two defs) from closing
// each other's window: each run gets its own key, so one lane's `exit`
// deletes only its own. WeakMap-by-ctx releases when the activation ends.
const keys = new WeakMap<StepContext, Map<object, object>>();

/**
 * A window of full invulnerability on this entity's `HitReceiver` — every
 * hit is ignored regardless of team or guards. This IS dodge:
 * `invulnerable({ from, to })` generalizes a hand-rolled i-frame slot.
 * Distinct from the timed i-frames a `HitReceiver` arms automatically after
 * a landed hit — that gate stacks with this one (either being active
 * ignores the hit). Windows are keyed per run, so overlapping windows (even
 * from the same step object reused across two lanes) keep the entity
 * protected until each one's own `exit` closes it.
 */
export const invulnerable = defineStep<object>("invulnerable", {
  enter: (params, ctx) => {
    const receiver = ctx.entity.tryGet(HitReceiver);
    if (!receiver) {
      throw new Error(
        `Abilities: step "invulnerable" requires a HitReceiver component on the entity.`,
      );
    }
    let byParams = keys.get(ctx);
    if (!byParams) keys.set(ctx, (byParams = new Map()));
    const key = {};
    byParams.set(params, key);
    receiver.openInvulnerability(key);
  },
  onDisable: (params, ctx) => {
    const receiver = requireReceiver(ctx);
    const key = keys.get(ctx)?.get(params);
    if (key) receiver.closeInvulnerability(key);
  },
  onEnable: (params, ctx) => {
    const receiver = requireReceiver(ctx);
    const key = keys.get(ctx)?.get(params);
    if (key) receiver.openInvulnerability(key);
  },
  exit: (params, ctx) => {
    const receiver = requireReceiver(ctx);
    const byParams = keys.get(ctx);
    const key = byParams?.get(params);
    if (key) {
      receiver.closeInvulnerability(key);
      byParams?.delete(params);
    }
  },
});

function requireReceiver(ctx: StepContext): HitReceiver {
  const receiver = ctx.entity.tryGet(HitReceiver);
  if (!receiver) {
    throw new Error(
      `Abilities: step "invulnerable" requires a HitReceiver component on the entity.`,
    );
  }
  return receiver;
}
