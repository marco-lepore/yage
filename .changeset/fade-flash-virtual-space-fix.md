---
"@yagejs/renderer": patch
---

Fix `fade` and `flash` overlay sizing under responsive fit. The full-screen rect was sized from `app.screen` (canvas pixels) but parented to `app.stage`, which carries the fit transform — so on devices where the virtual size differs from the canvas size (mobile letterbox, any non-1.0 fit ratio) the overlay covered only a fraction of the viewport. Now sized from `renderer.virtualSize` like the other transitions.
