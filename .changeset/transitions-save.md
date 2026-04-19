---
"@yagejs/save": patch
---

pr: 22
commit: 083b05bd9c9557ef32b9b82939e792983c4a5f9b
author: marco-lepore

Align with the new async scene-manager API.

- `SaveService.loadSnapshot` awaits `sceneManager.popAll()` before restoring scenes, matching the new async API.
