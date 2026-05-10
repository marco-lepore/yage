---
"@yagejs/renderer": minor
---

Re-home `fade`, `flash`, and `iris` overlays under the world-root architecture introduced in #59 (which moved the fit transform off `app.stage` onto a dedicated `_worldRoot`). All three now parent to `renderer.worldRoot` by default and size against `renderer.visibleCanvasRect` (the canvas extent in virtual pixels). Net effect:

- **letterbox** — overlay covers the virtual rect; bars stay visible (the worldRoot mask clips overshoot).
- **expand** — overlay paints into the bars too (no clipping mask under expand), matching the model where `expand` games treat the bar area as part of the play surface.
- **cover / stretch** — overlay covers what's on screen.

Adds an opt-in `coverScreen?: boolean` to `FadeOptions`, `FlashOptions`, and `IrisOptions` that re-parents the overlay to `app.stage` and sizes against `app.screen.width / .height` — covers the canvas including letterbox bars, for the rare case where the host-page background showing through is jarring.

`IrisOptions.center` and `IrisRevealOptions.center` are now both consistently in **virtual pixels** (game coordinates). When `coverScreen: true`, the iris center is converted internally via `renderer.virtualToCanvas`.

Also exposes `RendererPlugin.worldRoot: Container` as a public getter so custom transition authors can parent virtual-space overlays without resolving private internals.

The scene-root transitions (`chessboard`, `irisReveal`, `slidePush`) are unchanged — they manipulate scene roots directly and have always operated correctly in virtual pixels.
