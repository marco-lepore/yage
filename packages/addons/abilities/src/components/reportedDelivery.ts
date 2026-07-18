import type { Entity } from "@yagejs/core";
import { defineEvent } from "@yagejs/core";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitDelivery, HitDeliveryOptions } from "../core/hit/delivery.js";
import type { HitResult, StandardHitData } from "../core/hit/types.js";
import type { AbilityDef } from "../core/types.js";

/**
 * Emitted on the attacking entity (`hit.source`) each time one of its
 * deliveries reaches a receiver that processes it — a landed hit or a guard
 * outcome (`result !== "ignored"`), one emission per contact. The send-side
 * twin of `HitReceived`: a caster reacts to its own hit landing (hitstop,
 * cancel-into-followup) without subscribing on the victim. `result`
 * distinguishes `"hit"` / `"blocked"` / `"parried"`, so the attacker learns a
 * parry directly.
 *
 * `data` carries a fire-time shallow copy of the delivery's resolved hit data
 * — the values as fired, before per-victim guard reduction (a partial block
 * halves the victim's own copy, not this one). It is typed `unknown` because
 * the event token is a singleton typed against no vocabulary; a standard-data
 * game narrows it to
 * `StandardHitData` (reading `data.hitstop` to drive a freeze frame, say). For
 * a delivery fired by an ability step, `ability` is the def that fired
 * (`StepContext.def`); continuous sources like `TouchDamage` omit it.
 */
export const HitDealt = defineEvent<{
  target: Entity;
  result: HitResult;
  data: unknown;
  ability?: AbilityDef;
}>("hit:dealt");

/** Frozen provenance stamped into every `HitDealt` of a reporting delivery. */
export interface DeliveryProvenance {
  /** The ability def that fired the delivery, if any (see `HitDealt`). */
  ability?: AbilityDef;
}

/**
 * A `HitDelivery` that emits `HitDealt` on the source for every non-ignored
 * contact, layered over `createHitDelivery` (identical return value and
 * consume rule). The delivery built-ins use it; a custom per-system step can
 * too, or drop to bare `createHitDelivery` for no event.
 *
 * The `HitDealt` payload carries a shallow copy of `options.data` captured
 * here at fire time plus `provenance.ability`, so a landed-hit listener reads
 * the values the delivery fired with regardless of per-victim mutation.
 */
export function createReportingDelivery<TData = StandardHitData>(
  options: HitDeliveryOptions<TData>,
  provenance?: DeliveryProvenance,
): HitDelivery {
  const delivery = createHitDelivery<TData>(options);
  const { source } = options;
  const data: unknown = { ...(options.data ?? {}) };
  const ability = provenance?.ability;
  return {
    deliver(target, from) {
      const result = delivery.deliver(target, from);
      if (result !== "ignored") {
        source.emit(HitDealt, {
          target,
          result,
          data,
          ...(ability !== undefined ? { ability } : {}),
        });
      }
      return result;
    },
  };
}
