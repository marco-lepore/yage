---
"@yagejs/renderer": patch
---

A followed camera can start on its target instead of gliding in from the world origin.

- `snap: true` on `CameraEntity` params and on `CameraFollowOptions` places the camera on the follow target as following starts, offset included. Any `smoothing` below `1` eases from the camera's current position, so a camera that spawns without an explicit `position` opens the scene with a visible glide from `(0, 0)` to the player.
- `snapToTarget()` on `CameraEntity`, `CameraComponent`, and `CameraFollow` does the same cut on demand — for a room change or a respawn, where easing across the map is the wrong look. It does nothing when no target is set.
- Both skip the deadzone for that one move, centring the target. The deadzone applies again from the next frame, and camera bounds clamp on the next frame as they do for any other camera move.
