---
"create-yage": patch
---

The starter template's camera cuts back to the spawn point on a respawn.

- Touching a hazard teleports the player to the spawn point. The camera follows at `smoothing: 0.12`, so a death at the far end of the level showed the camera easing the whole way back across it. The respawn handler calls `snapToTarget()` after the teleport, so the camera cuts.
- The camera also passes `snap: true`. Under the bounds the template ships, the opening frame was already framed correctly; the option keeps it correct once the world constants are changed, which is among the first edits a starter project gets.
