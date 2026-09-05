---
"@yagejs/debug": minor
---

Keep diagnostic frames, clock control, and scene state consistent.

- Use `Inspector.time` for public clock control. Remove the global `clock` slot, its public type, and the separate debug frame counter.
- Add `WorldDebugApi.forScene(scene)` so vectors and custom diagnostics follow each visible scene's effective camera. Share one graphics limit across all scenes and release drawing resources on scene exit.
- Attribute contributor failures to their name and callback method before propagating the error.
