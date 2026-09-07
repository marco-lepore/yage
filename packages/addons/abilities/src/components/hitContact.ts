import type {
  ColliderComponent,
  CollisionEvent,
  TriggerEvent,
} from "@yagejs/physics";
import type { HitContact } from "../core/hit/types.js";

/** The shape pair a physics event named, enough to measure it again later. */
export type HitContactPair = Pick<
  TriggerEvent,
  "otherCollider" | "selfShapeIndex" | "otherShapeIndex"
>;

/**
 * The contact geometry behind a physics event that reached `self`'s handler,
 * as the target-side `HitContact` for `HitDelivery.deliver`. A solid
 * collision's own contact data is used when present; otherwise (every sensor
 * event) the shape pair that fired the event is measured with
 * `ColliderComponent.contactWith`. `undefined` when neither is available.
 *
 * ```ts
 * collider.onTrigger((ev) => {
 *   if (ev.entered) delivery.deliver(ev.other, origin, resolveHitContact(collider, ev));
 * });
 * ```
 */
export function resolveHitContact(
  self: ColliderComponent,
  ev: TriggerEvent | CollisionEvent,
): HitContact | undefined {
  if ("started" in ev && ev.contactPoint && ev.contactNormal) {
    return { point: ev.contactPoint, normal: ev.contactNormal.scale(-1) };
  }
  return queryHitContact(self, ev);
}

/**
 * Measure the shape pair `pair` names at its current pose (see
 * `ColliderComponent.contactWith`) as the target-side `HitContact`: the
 * point on the other collider's surface and its outward normal. For a
 * repeat delivery to a target still in contact. `undefined` when the shapes
 * no longer touch or either collider is gone.
 */
export function queryHitContact(
  self: ColliderComponent,
  pair: HitContactPair,
): HitContact | undefined {
  const contact = self.contactWith(pair.otherCollider, {
    selfShapeIndex: pair.selfShapeIndex,
    otherShapeIndex: pair.otherShapeIndex,
  });
  return contact
    ? { point: contact.otherPoint, normal: contact.normal.scale(-1) }
    : undefined;
}
