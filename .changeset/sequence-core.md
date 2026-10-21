---
"@yagejs/core": patch
---

Add authored keyframe sequences and the editor's Sequence mode.

- Export `sampleKeyframes(keys, time, easing?)`, which reads a keyframe track at one time without running a `Process` or calling keyframe events. Keyframe tracks sample through the same function.
- A keyframe track whose `duration` runs past its last keyframe holds that keyframe's value until it completes, the same value it sets on completion.
