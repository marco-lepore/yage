---
"@yagejs/core": patch
---

A keyframe animation picks the clock that advances its playback.

- `KeyframeAnimationDef.clock` takes `"frame"` (the default, rendered-frame time) or `"fixed"` (the fixed timestep, through `ProcessFixedUpdateSystem`). Omitting it keeps playback on rendered-frame time, so existing animations are unaffected.
- The choice is per animation, so one `KeyframeAnimator` can hold a frame-clock visual and a fixed-clock event timeline.
- `"fixed"` is for setter-less timelines whose keyframe `event` callbacks drive gameplay: their beats then land at the same simulation time every run. A setter on `"fixed"` is written only on fixed steps, so a rendered frame that runs none shows the previous value.
