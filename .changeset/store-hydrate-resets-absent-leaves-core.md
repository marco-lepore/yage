---
"@yagejs/core": minor
---

Loading a save into a store no longer keeps values from the running session.

- `createStore().hydrate` replaces the whole store. A leaf missing from the payload resets to its default, so a save written before the leaf existed loads with that leaf at its default. `Save.restore` and `Save.loadSlot` get this behaviour through `hydrate`.
- Before, a missing leaf kept its current value. Loading an older slot from the title screen carried the abandoned session's state into the loaded game.
- If a leaf fails to decode, `hydrate` throws and every leaf, including the ones it reset, keeps its previous value.
