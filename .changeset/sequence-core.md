---
"@yagejs/core": minor
---

Add authored sequence playback and editing.

- Expose `sampleKeyframes` for pure curve sampling without dispatching key events, and share it with existing keyframe processes.
- Expose `durationReached` so addons can use the engine's floating-point tolerance at playback boundaries.
