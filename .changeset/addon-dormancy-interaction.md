---
"@yagejs-addons/interaction": minor
---

Interaction now follows entity activeness, so an entity you turn off or hand back to a pool takes its interaction state with it.

- An `Interactable` registers while it is running and unregisters while it is not. A disabled component or a dormant entity is no longer a focus candidate for any interactor, and `interactablesIn()` does not return it. Its focus tie-break order is claimed once, so a target that goes dormant and comes back does not jump the queue.
- An `Interactor` empties its in-range snapshot (emitting the transitions) when its entity is deactivated, the same way it already did for `enabled = false`, and `interact()` does nothing while the entity is dormant.
- `Interactor` no longer installs its own `enabled` accessor: `Component.enabled` fires the enable hooks by itself, so the toggle keeps working through the engine's own lifecycle.

`Interactable.isEnabled()` is unchanged — it stays the game's own gate and says nothing about whether the entity is live.
