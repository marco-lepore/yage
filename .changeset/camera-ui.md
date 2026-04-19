---
"@yagejs/ui": minor
---

pr: 21
commit: 32b35dcc89b5e28fdb852a08127f0a6f06ded819
author: marco-lepore

Rework the camera system into an entity + layer-binding model, and give every scene its own container.

- `UIPanel` auto-provisions a `"ui"` layer via `ensureLayer(def, { space: "screen" })` when the scene didn't declare one, keeping UI pinned to the viewport without any camera wiring.
- `UIPanel` can now target a world-space layer deliberately — declare a `LayerDef` with `space: "world"` (the default) and pass its name via `UIPanelOptions.layer` to get diegetic UI that follows the camera (interaction prompts, entity-anchored health bars, damage numbers). The previous throw that rejected UI on camera-auto-bindable layers is gone; the layer's declared `space` is now the single source of truth.
- `layer.container.eventMode = "static"` is applied whether UIPanel creates the layer or reuses an existing one, so HUD hit-testing works in both cases.
