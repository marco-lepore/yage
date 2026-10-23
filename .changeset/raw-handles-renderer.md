---
"@yagejs/renderer": minor
---

Visual components hand out their Pixi object under one name, `renderObject`.

- Breaking: `SpriteComponent.sprite`, `AnimatedSpriteComponent.animatedSprite`, `GraphicsComponent.graphics`, `TextComponent.text` and `SplitTextComponent.splitText` are removed. Change a visual through its component: `visible`, `alpha`, `tint`, `setText`, `mergeStyle`, `draw`. `content` reads a text's string.
