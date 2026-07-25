---
"@yagejs/save": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `EntitySnapshotEntry` gains an optional `activeSelf` field, written only when an entity is dormant. Snapshots without it restore as active, so existing saves load unchanged.
- Restore holds every entity inert until the parent links are rebuilt, then settles activeness once per subtree. Each component's `onEnable` fires exactly once, on an entity whose hierarchy is already complete.
