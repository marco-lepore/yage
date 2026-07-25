---
"@yagejs/renderer": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- The five visual components hide their display object while the entity is dormant and show it again on reactivation.
- `visible` now stores what you set and reads it back unchanged; the Pixi flag is that value combined with the component being effectively enabled. Hiding a sprite by hand survives a deactivate/reactivate cycle, and a snapshot taken while the entity is dormant records your value rather than `false`.
- Setting `component.enabled = false` hides the display object instead of leaving it painted in place.
