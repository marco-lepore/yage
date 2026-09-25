---
"@yagejs/examples": patch
---

The platformer's jump reaches its full height again, about 130 px instead of
8 px. The moving-platform carry clamped the player's vertical velocity to at
least 0 on every physics step, which cancelled a jump on the step after
takeoff. It now applies only while the player stands on a descending platform.
