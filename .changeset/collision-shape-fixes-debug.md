---
"@yagejs/debug": patch
---

Tiled collision-shape extraction and physics/debug correctness fixes, plus collider rotation support.

- Contributor registration no longer resets declared flags to `true`, so `DebugConfig.flags` overrides applied at install survive the built-in contributors registering in `onStart`.
