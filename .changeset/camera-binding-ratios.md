---
"@yagejs/renderer": minor
---

Two additions for world-space UI and layer decoupling.

**`ScreenFollow` component.** Each frame projects a world source through a camera and writes the resulting screen coord to this entity's `Transform.worldPosition`. The canonical billboard primitive: pair with `UIPanel` / `UIRoot` on a screen-space layer using `positioning: "transform"` to produce entity-anchored UI (nameplates, health bars, damage numbers) that tracks a target while staying axis-aligned and constant-size under any camera zoom or rotation. `target` accepts an `Entity`, a static `Vec2Like`, or a function returning a `Vec2Like` — for midpoints, animated paths, or arbitrary world sources. `offset` is in screen pixels, applied *after* projection (`cam.worldToScreen(target) + offset`), so the visual gap between UI and target stays fixed under any camera zoom or rotation.

**`CameraBinding` gains two new per-axis ratios** alongside the existing `translateRatio`: `rotateRatio` and `scaleRatio`. All three default to `1` (full camera effect), so existing parallax bindings are unchanged.

- `rotateRatio: 0` — the bound layer stays upright regardless of camera rotation.
- `scaleRatio: 0` — the bound layer stays at unit scale regardless of camera zoom.
- Values in between blend linearly.

These are **layer-level decoupling primitives** — useful for parallax, minimaps, and camera-agnostic world overlays. They are NOT the right answer for entity-anchored UI (use `ScreenFollow` + `positioning: "transform"` for that). The math in `DisplaySystem.applyCameraTransforms` reduces to the previous implementation exactly when all three ratios are `1`, so nothing changes for cameras that don't opt in.
