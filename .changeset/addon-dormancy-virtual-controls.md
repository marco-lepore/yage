---
"@yagejs-addons/virtual-controls": minor
---

The touch overlay now follows entity activeness. Deactivating its host entity — or setting `controls.enabled = false` — hides the views and releases every engaged control, so a dormant HUD entity leaves no painted controls on screen and no stuck action holds.

`visible` stores what you set and reads it back unchanged; the views are on screen when the overlay is on and the component is running. A hand-set `setVisible(false)` survives a deactivate/reactivate cycle.
