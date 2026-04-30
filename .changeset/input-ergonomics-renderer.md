---
"@yagejs/renderer": minor
---

Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.

- `RendererPlugin` now implements the `hitTestUI(x, y)` extension on `RendererAdapter`. Walks Pixi's `EventBoundary.rootBoundary.hitTest` result up the parent chain and returns `true` when any ancestor was flagged via `markPointerConsumeContainer` (from `@yagejs/core`). `@yagejs/input` calls this on `pointerdown` drains to auto-claim presses landing on UI surfaces.
- `SpriteComponent` and `AnimatedSpriteComponent` gain an optional `interactive?: { eventMode?, consumeOnInteraction? }` config. When `interactive` is set, the underlying Pixi sprite gets `eventMode: "static"` (or whatever was passed). When `consumeOnInteraction: true`, the sprite is also added to the consume registry — pointer presses landing on it auto-claim, so a tappable in-world sprite never double-fires gameplay actions like `MouseLeft`. Default `false` preserves the "I want both Pixi events AND the action map" use case.
