---
"@yagejs/renderer": minor
---

Warn and fall back to the default layer when a renderable targets an undeclared layer.

- A visual component (`SpriteComponent`, `GraphicsComponent`, `AnimatedSpriteComponent`, `TextComponent`, `SplitTextComponent`, or a custom `LayerRenderable`) whose `layer` names a layer the scene never declared now emits a dev-mode `[yage]` warning — naming the entity, the missing layer, and the scene — and renders into the `"default"` layer, instead of failing with an opaque `RenderLayer not found` error and a silently missing sprite. The warning is tree-shaken from production builds.
- Clarified that `RendererAdapter.hitTestUI` only detects surfaces marked via `markPointerConsumeContainer` (`@yagejs/ui` primitives and `Sprite` / `AnimatedSprite` components), not raw-Pixi UI such as the dialogue addon's box; dialogue-aware callers should gate on `DialogueController.isActive()` / `isChoosing()`.
