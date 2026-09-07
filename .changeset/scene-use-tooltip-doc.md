---
"@yagejs/ui": patch
---

`attachTooltip`'s documented escape hatch for custom popovers acquires the floating overlay with `scene.use(FloatingOverlayKey)`, the public scope-aware read, instead of an internal alias that returns `undefined` when the overlay is absent.
