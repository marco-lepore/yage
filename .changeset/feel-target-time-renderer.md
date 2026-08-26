---
"@yagejs/renderer": patch
---

Expand timing and animation support for feedback cues.

- Apply `AnimationController.speed` changes to the active sprite and keep single and layered automatically timed one-shot locks aligned when the combined definition and controller speed produces a positive finite duration.
