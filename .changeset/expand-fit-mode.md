---
"@yagejs/renderer": minor
---

Add `expand` fit mode plus canvas/visible geometry API.

The existing `cover` uses CSS-cover semantics — it scales by `max` and crops the declared virtual rect on the long axis. For most games that's wrong: aspect ratio changes what the player can see. `expand` is the game-friendly alternative, matching Godot's `stretch/aspect=expand`, Unity's `Screen Match Mode=Expand`, and Construct 3's "Scale inner": virtual is always fully visible (same scale/offset as `letterbox`), but the leftover canvas space is the game's to draw into — fog, parallax, decorative backdrop, bar-anchored HUD — rather than painted with the background color.

- `FitMode` adds `"expand"`. Geometry is identical to `letterbox`; the difference is rendering convention.
- New `virtualCanvasRect: CanvasRect` — where the declared virtual rect sits on the canvas, in CSS pixels. Useful for DOM overlays positioned over the play area, cropping screenshots to gameplay, and mapping CSS-coord hit regions. `CanvasRect` is a new alias of `VirtualRect` so signatures signal which coordinate space a rect is in.
- New `visibleCanvasRect: VirtualRect` — full canvas extent in virtual-space pixels, **not clamped** to the declared virtual rect. Under `letterbox`/`expand` on an off-aspect host it extends past virtual on the bar axis. Under `cover` it equals `visibleVirtualRect`; under `stretch` it equals the virtual rect. Iterate against it for backdrops that must fill the entire visible canvas, or anchor HUDs to the canvas corners instead of the play-area corners.
- New `extendedVirtualRects: readonly VirtualRect[]` — the complement of `virtualRect` inside `visibleCanvasRect`: 0–2 strips of visible canvas that sit outside the virtual rect, in virtual-space pixels. Populated under `letterbox` and `expand` when aspect mismatches; empty under `cover` and `stretch`. Drives fog-over-bars under `expand` and also describes where the `backgroundColor` bars live under `letterbox` (useful for future bar customization).
- New `virtualToCanvas(x, y): Vec2` forward transform, symmetric with the existing `canvasToVirtual`.
- The `responsive-ui` example is rewritten against `expand`: grid extends across the full visible canvas, fog overlays the bars via `extendedVirtualRects`, and HUD corners anchor to `visibleCanvasRect` so cards land in the bars under off-aspect viewports. The fog/mask hack around `croppedVirtualRects` is gone.

Non-breaking: `letterbox` / `cover` / `stretch` keep their existing semantics and geometry. Existing code that reads `visibleVirtualRect` or `croppedVirtualRects` keeps working unchanged.
