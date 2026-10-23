---
"@yagejs/renderer": patch
---

`VisualComponent.drawInactive(shown)` draws a visual whose entity is inactive, which `DisplaySystem` skips. It places the visual at the pose its `Transform` composes, with its transform modifiers, and shows it when `shown` and the component's own `enabled` and `visible` allow it. It throws for an active entity.
