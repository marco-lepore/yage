---
"@yagejs/core": minor
---

Expand timing and animation support for feedback cues.

- Add composable, raw-timed `SceneTime` requests for one entity's updates.
- Let scene freeze requests keep selected entity updates running while physics remains frozen.
- End entity requests and update exclusions when a pooled entity's current life ends.
