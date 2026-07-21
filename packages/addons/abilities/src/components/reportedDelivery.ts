import type { Entity } from "@yagejs/core";
import { defineEvent } from "@yagejs/core";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitDelivery, HitDeliveryOptions } from "../core/hit/delivery.js";
import type { HitResult, StandardHitData } from "../core/hit/types.js";
import type { AbilityDef } from "../core/types.js";
import { HitReceiver } from "./HitReceiver.js";

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
 * halves the victim's own copy, not this one). The singleton event uses the
 * addon's default `StandardHitData` vocabulary. Custom combat systems narrow
 * the payload at this boundary with their own predicate. For a delivery
 * fired by an ability step, `ability` is the def that fired
 * (`StepContext.def`); continuous sources like `TouchDamage` omit it.
 */
export interface HitDealtPayload {
  target: Entity;
  result: HitResult;
  data: StandardHitData;
  ability?: AbilityDef;
}

export const HitDealt = defineEvent<HitDealtPayload>("hit:dealt");

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
  const { source } = options;
  const inheritedTeam = source.tryGet(HitReceiver)?.team;
  const team = options.team ?? inheritedTeam;
  const resolvedOptions: HitDeliveryOptions<TData> = {
    ...options,
    ...(team !== undefined ? { team } : {}),
  };
  const delivery = createHitDelivery<TData>(resolvedOptions);
  const data = { ...(options.data ?? {}) } as StandardHitData;
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
