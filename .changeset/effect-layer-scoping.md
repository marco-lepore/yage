---
"@yagejs/renderer": patch
---

Scope an effect to a set of layers, or lift one visual out of every effect.

- `tree.addLayerEffect(factory, layers)` attaches one effect to several named layers and returns one handle for all of them: methods fan out, values come from the first listed layer. The factory runs once per layer, so this costs one filter pass per listed layer. Throws on an empty list or an unknown layer name, before attaching anything.
- `VisualComponentOptions.renderAboveEffects` (and a matching runtime setter on every visual component) draws a visual after the scene's layers, outside every layer- and scene-scope effect, `setMask`, and the `irisReveal` / `chessboard` transition masks, while its logical parent still drives position, alpha, visibility, and camera. Screen-scope effects still cover it, and hit testing follows the logical tree. `tree.renderAboveEffects(node)` / `tree.renderWithEffects(node)` do the same for a display object the game parents in itself.

Together these cover the common "grade the world but not the HUD" case, which previously needed one `addEffect` call per layer.
