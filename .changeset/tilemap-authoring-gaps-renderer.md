---
"@yagejs/renderer": patch
---

Carry through the parts of a Tiled map the package used to drop, and report the forms it cannot render.

- Export `VisualComponent`, `visualOptionsFromData`, and the `VisualComponentOptions` / `VisualComponentData` / `VisualInteractiveOptions` types. The base behind the five built-in visual components is now public, so a component in another package can join it and pick up the render-layer field, effects host, mask lifecycle, and the shared visible/tint/alpha/blend-mode vocabulary. `@yagejs/tilemap`'s `TilemapComponent` is the first such consumer.
