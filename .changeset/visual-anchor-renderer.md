---
"@yagejs/renderer": patch
---

A visual's anchor and pivot can be read and moved after construction.

- `SpriteComponent`, `AnimatedSpriteComponent`, `TextComponent` and `NineSliceComponent` have an `anchor` getter and setter, and `GraphicsComponent` a `pivot` getter and setter. A read returns a new `{ x, y }`.
- `SplitTextComponent.anchor` reads and moves the block anchor. It reads `undefined` until one is set, and assigning `undefined` puts the text's layout origin back on the entity.
- The `anchor` and `pivot` options and setters throw on a non-finite coordinate, and so does an `AnimationController` constructed with a non-finite `anchor` in an animation, naming that animation.
