---
"@yagejs/renderer": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `CameraComponent`, `CameraFollow`, `CameraShake`, `CameraZoom`, `CameraBoundsComponent`, and `ScreenFollow` are now `@serializable`, with explicit `serialize()` / `static fromSnapshot(data)` pairs. Inspector world snapshots and save-system slots now capture full camera state (position, zoom, rotation, follow target by entity id, shake/zoom processes, bounds rect, parallax bindings).
- New public types: `CameraComponentData`, `CameraFollowData`, `CameraShakeData`, `CameraZoomData`, `CameraBoundsComponentData`, `ScreenFollowData` (exported from the package barrel).
