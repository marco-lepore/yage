import type { Entity } from "@yagejs/core";
import { defineEvent } from "@yagejs/core";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitDelivery, HitDeliveryOptions } from "../core/hit/delivery.js";
import type { HitResult, StandardHitData } from "../core/hit/types.js";

/**
 * Emitted on the attacking entity (`hit.source`) each time one of its
 * deliveries reaches a receiver that processes it — a landed hit or a guard
 * outcome (`result !== "ignored"`), one emission per contact. The send-side
 * twin of `HitReceived`: a caster reacts to its own hit landing (hitstop,
 * cancel-into-followup) without subscribing on the victim. `result`
 * distinguishes `"hit"` / `"blocked"` / `"parried"`, so the attacker learns a
 * parry directly.
 */
export const HitDealt = defineEvent<{ target: Entity; result: HitResult }>(
  "hit:dealt",
);

/**
 * A `HitDelivery` that emits `HitDealt` on the source for every non-ignored
 * contact, layered over `createHitDelivery` (identical return value and
 * consume rule). The delivery built-ins use it; a custom per-system step can
 * too, or drop to bare `createHitDelivery` for no event.
 */
export function createReportingDelivery<TData = StandardHitData>(
  options: HitDeliveryOptions<TData>,
): HitDelivery {
  const delivery = createHitDelivery<TData>(options);
  const { source } = options;
  return {
    deliver(target, from) {
      const result = delivery.deliver(target, from);
      if (result !== "ignored") source.emit(HitDealt, { target, result });
      return result;
    },
  };
}
