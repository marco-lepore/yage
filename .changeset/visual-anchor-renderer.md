---
"@yagejs/renderer": patch
---

A visual's anchor and pivot can be read and moved after construction.

- `SpriteComponent`, `AnimatedSpriteComponent`, `TextComponent`, `SplitTextComponent` and `NineSliceComponent` have an `anchor` getter and setter, and `GraphicsComponent` a `pivot` getter and setter. A read returns a new `{ x, y }`.
- The `anchor` and `pivot` options and setters throw on a non-finite coordinate.
- `AnimationController` writes an animation's `anchor` through the sprite's setter, so it replaces a runtime anchor at the next switch to that animation.
