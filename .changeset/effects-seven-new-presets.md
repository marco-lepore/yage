---
"@yagejs/effects": minor
---

Add 7 new effect presets: `godRay` (animated volumetric light shafts), `shockwave` (concentric-ring ripple with `trigger(x, y)`), `motionBlur` (directional streak with `setVelocity`), `oldFilm` (sepia + grain + scratches + vignette), `bulgePinch` (lens-distortion bulge or pinch with `setStrength` / `setCenter` / `setRadius`), `halftone` (custom WebGL+WGSL comic-print dot grid), and `wave` (custom WebGL+WGSL horizontal-shimmer distortion). Each preset registers a stable `yage:<name>` string so it round-trips through `SaveService.saveSnapshot` / `loadSnapshot`. Self-animating presets (`godRay`, `oldFilm`, `wave`, plus `shockwave` after `trigger()`) drive their time uniforms through the engine's process scheduler, so they pause with the owning scene and time-scale with it.
