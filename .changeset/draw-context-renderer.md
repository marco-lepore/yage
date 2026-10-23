---
"@yagejs/renderer": minor
---

Drawing callbacks receive a `DrawContext`, which holds Pixi's drawing vocabulary and nothing else.

- `GraphicsComponent.draw`, `RendererPlugin.createTexture` and `graphicsMask` pass their callback a `DrawContext`: shapes, paths, `fill` and `stroke`, `texture`, `cut`, `clear`, the transform stack and `save` / `restore`. The Pixi `Graphics` itself is passed, so nothing is wrapped.
- Breaking: `GraphicsContext` is removed. A helper that draws for a callback takes a `DrawContext`, and `GraphicsComponent.renderObject` is typed `DisplayGraphics`. Code that called `addChild`, set `position`, `alpha` or `visible`, or called `destroy` on the callback's parameter changes the visual through the component instead.
- `DrawFill`, `DrawStroke`, `DrawPath`, `DrawMatrix` and `DrawRoundedPoint` name the types the drawing methods take.
