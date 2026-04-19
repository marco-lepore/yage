---
"@yagejs/debug": patch
---

pr: 21
commit: 32b35dcc89b5e28fdb852a08127f0a6f06ded819
author: marco-lepore

Rework the camera system into an entity + layer-binding model, and give every scene its own container.

- `DebugScene` declares its layers without `space`; the overlay now uses the same auto-binding model as user scenes.
- `DebugRenderSystem` factors `cam.rotation` into the world-container translation, matching the main `DisplaySystem`.
- `findTopmostCamera` returns the highest-priority **enabled** camera on the topmost scene with one, matching `DisplaySystem`'s own selection rules instead of picking whichever camera happened to be found first.
