---
"@yagejs-addons/inventory": minor
---

Addon components now follow entity activeness, so disabling a component or deactivating its entity also sleeps resources that live outside `update()`.

- `InventoryController` hides and pauses its session, releases input listeners, and stops its model-to-entity event mirror while dormant. It preserves browsing state and refreshes the current source on enable.
- `InventorySession` exposes separate hidden and paused states for custom hosts.
- Keyboard and pointer bindings can bind again after disposal without retaining stale input state.
