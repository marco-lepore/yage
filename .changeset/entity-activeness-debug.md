---
"@yagejs/debug": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `findTopmostCamera` skips cameras on dormant entities, matching `DisplaySystem`, which reaches cameras through a query and so never sees one.
- The `getCameraStack` diagnostic reports each camera's effective enabled-ness — its own flag combined with an active entity — rather than the flag alone.
