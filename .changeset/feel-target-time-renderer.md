---
"@yagejs/renderer": patch
---

Expand timing and animation support for feedback cues.

- Apply live speed changes to active sprites and automatically timed one-shot locks. Layered controllers share the first controller's retimed lock and provide one speed multiplier for every layer.
