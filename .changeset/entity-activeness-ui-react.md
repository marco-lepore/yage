---
"@yagejs/ui-react": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `UIRoot` hides its React tree while the entity is dormant. Hiding the container also takes the tree out of pointer hit-testing, so a dormant UI no longer claims presses.
