---
"@yagejs/ui": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `UISurface` hides its UI tree while the entity is dormant. `visible` stores what you set and reads it back unchanged, so hiding a surface by hand survives a deactivate/reactivate cycle.
