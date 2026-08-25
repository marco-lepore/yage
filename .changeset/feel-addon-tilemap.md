---
"@yagejs/tilemap": patch
---

Add composable game-feel cues with visual, time, camera, audio, filter, and
particle effects.

- Keep tilemap base alpha separate from inherited visual opacity modifiers.
- Combine tilemap transforms with inherited visual position, rotation, and
  scale modifiers during rendering.
- Apply effective alpha through the tilemap color filter without changing the
  serialized base value.
