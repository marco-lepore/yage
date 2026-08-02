---
"@yagejs/physics": patch
---

Dynamic bodies are drawn at an interpolated position, and their exact simulated pose is readable.

- Render interpolation blends between the last two fixed steps. Physics runs at a constant rate that rarely lines up with the display refresh rate, and a dynamic body's `Transform` now carries that blend, so a body moving at constant velocity advances by the same distance every frame instead of stepping and pausing.
- The blend runs at the start of `Update`, before component `update(dt)`. Game logic reads the same position that gets drawn that frame — a camera following a body no longer alternates between two different poses. A paused scene holds its blend still, so pausing does not move anything on screen.
- `RigidBodyComponent` gains `position`, `positionX`, `positionY` and `rotation` — the exact simulated pose as of the last completed fixed step, for the cases where a number must match the simulation rather than the drawn position. `positionX` / `positionY` skip the `Vec2` allocation. Without a live Rapier body they fall back to the entity's `Transform`.
