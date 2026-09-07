---
"@yagejs-addons/abilities": patch
---

Hits carry where they landed. `Hit.contact` is an optional `HitContact` with the world-pixel `point` on the target collider's surface and the unit `normal` out of that surface toward the attacking shape, so presentation can place an impact effect on the struck surface without a second physics query. `direction` keeps its meaning.

- `hitbox` and a sensor `Projectile` measure the sensor/target collider pair that fired the trigger (`ColliderComponent.contactWith`), so a compound target reports the part that was hit. A solid `Projectile` or `TouchDamage` body uses the collision's own contact. Repeat hits (`every`, the touch interval) measure again.
- The geometry is captured before the receiver runs, and `HitDealt` carries it as `contact`, so a killing hit still reports where it landed.
- `HitDelivery.deliver(target, from, contact?)` takes the geometry a custom source already knows. `resolveHitContact(collider, event)` turns a trigger or collision event into it; `queryHitContact(collider, pair)` re-measures a remembered pair.
- `contact` is absent when nothing could be measured. A hitbox whose window opens already overlapping the target reports a surface point from the current overlap, not the first impact of the swing. Existing callers and custom `HitDelivery` implementations are unchanged.
