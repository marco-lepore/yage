---
"@yagejs/renderer": patch
---

Expand timing and animation support for feedback cues.

- Apply `AnimationController.speed` changes to the active sprite and keep positive-speed, automatically timed one-shot locks aligned without changing pause or reverse playback.
