---
"@yagejs/ui": minor
---

pr: 21
commit: 32b35dcc89b5e28fdb852a08127f0a6f06ded819
author: marco-lepore

Rework the camera system into an entity + layer-binding model, and give every scene its own container.

- `UIPanel` auto-provisions a `"ui"` layer via `ensureLayer({ autoBindable: false })` when the scene didn't declare one, keeping UI in screen-space without any camera wiring.
- Adding a `UIPanel` to a layer that would be auto-bound by the default camera now throws with a pointer at how to fix it (remove the layer from `Scene.layers`, or pass explicit `CameraEntity { bindings }` that exclude it). This prevents the surprise of UI scrolling with the world.
- `layer.container.eventMode = "static"` is applied whether UIPanel creates the layer or reuses an existing opted-out one, so HUD hit-testing works in both cases.
