---
"@yagejs/renderer": minor
---

`AnimatedSpriteComponent` now accepts `anchor` and `tint` options.

`AnimatedSpriteComponentOptions` gained:

- `anchor?: Vec2Like | readonly [number, number]` — component-level default anchor, applied during setup. Per-`AnimationDef.anchor` overrides this when set.
- `tint?: number | string` — forwarded to `AnimatedSprite.tint` (Pixi v8 accepts both numeric colors and color strings).

Brings `AnimatedSpriteComponent` to parity with the equivalent setters on `SpriteComponent` so swapping between the two needs no extra boilerplate.
