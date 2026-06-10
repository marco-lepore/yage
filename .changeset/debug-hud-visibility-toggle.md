---
"@yagejs/debug": minor
---

`DebugDiagnostics` (the inspector's `debug` extension) gains HUD visibility controls: `isHudVisible()` and `setHudVisible(visible)`. The toggle affects only the `debug-hud` layer — the screen-space text readouts (FPS, system timings, entity counts) — leaving world-space debug graphics such as collider outlines visible, and re-renders the stage synchronously so the change reaches the canvas even while the debug clock is frozen. Capture tooling uses it to keep wall-clock-dependent text out of canvas screenshots that would otherwise differ on every run; the examples snapshot harness hides the HUD before its dump-mode screenshots.
