---
"@yagejs/debug": patch
---

pr: 20
commit: 6143e0346820dd74d78b1d345ac4ebc5e4294769
author: marco-lepore

Adopt scene-scoped DI.

- `DebugPlugin` now mounts a detached `DebugScene` through `SceneManager._mountDetached`, routing the overlay through the same scoped-DI lifecycle and per-scene render tree as stacked scenes while staying off the user-visible stack.
