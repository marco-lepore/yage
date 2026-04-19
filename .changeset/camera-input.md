---
"@yagejs/input": minor
---

pr: 21
commit: 32b35dcc89b5e28fdb852a08127f0a6f06ded819
author: marco-lepore

Rework the camera system into an entity + layer-binding model, and give every scene its own container.

- `InputManager._setCamera` is now the public `setCamera(camera)`, paired with `clearCamera()`. Games wire the camera in `onEnter` (and clear it in `onExit`) because `CameraEntity` is spawned per-scene; the engine cannot install it at plugin time.
- `InputConfig.cameraKey` is removed. There is no singleton camera key anymore, so the auto-install path it fed no longer exists.
