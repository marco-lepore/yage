---
"@yagejs/physics": patch
---

Interpolate kinematic bodies between fixed steps, the same way dynamic bodies already are

- Kinematic bodies are now rendered from the same prev/curr blend as dynamic bodies. The drawn gap between a moving platform and a body riding it stays constant, including through direction reversals.
- The `Transform` of a kinematic body is the movement input: a pose written there (ideally in `fixedUpdate`) becomes the target the body reaches on the next physics step. Writes from `update()` are picked up one frame later.
- `rb.setPosition()` teleports any body type, kinematic included: no smoothing, no pull-back toward the previous target. On a kinematic body, `transform.setPosition()` is the smooth one-step move.
- New `rb.setRotation(radians)` — the rotation counterpart of `rb.setPosition()`.
- Rotation is drawn along the shortest arc, so a spinning body crossing the ±π boundary no longer draws a one-step reverse sweep.
