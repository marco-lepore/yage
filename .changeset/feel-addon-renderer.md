---
"@yagejs/renderer": minor
---

Add composable game-feel cues with visual, time, camera, audio, filter, and
particle effects.

- Add independently removable visual modifiers for position, rotation, scale,
  opacity, and visibility.
- Add camera modifiers for position, rotation, and zoom, and expose effective
  camera values to rendering and coordinate conversion.
- Make built-in camera shake contribute through the camera modifier host.
- Let effect attachments opt out of save snapshots for owner-managed runtime
  pulses.
