---
"@yagejs-addons/abilities": minor
---

Clarify addon composition and lifecycle contracts.

- Add lane-scoped `release` and have `AbilityDriver` release its own activation's lane.
- Attribute step hooks and cooldown callbacks. Reject non-finite cooldowns before cooldown state changes; a throwing hook remains terminal.
- Ignore destroyed hit targets without invalidating attacks from destroyed casters.
- Add typed `spawn.acquire` for game-owned pools, including optional setup-context inference. Returning `undefined` skips the spawn without a fallback.
- Add `Projectile.sensor`, `gravityScale`, and `consume` for solid collision response and one-way platform composition. The supplied projectile is not poolable.
- Rename health and hit event ids to `abilities:health:*` and `abilities:hit:*`. Existing exported tokens remain; old string ids are not aliases.
