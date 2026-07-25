---
"@yagejs/tilemap": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `TilemapComponent` hides its rendered layers while the entity is dormant and shows them again on reactivation.
