---
"@yagejs/renderer": minor
---

Keep diagnostic frames, clock control, and scene state consistent.

- Export `syncCameraTransform(target, camera?, binding?)` to apply an effective camera pose and optional binding ratios. Renderer layers and scene debug drawing use the same camera transform.
