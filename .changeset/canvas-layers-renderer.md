---
"@yagejs/renderer": patch
---

A layer declared with `space: "canvas"` draws in canvas pixels, outside the responsive fit and its letterbox clip, so content reaches the letterbox bars.

- Each scene keeps its canvas layers in a second root above every scene's world and screen layers. The root is hidden, reordered and destroyed with its scene.
- No camera binds a canvas layer; a camera `bindings` entry that names one throws. The scene's `fx` and `setMask` do not cover it, and `renderAboveEffects` leaves a node on it in place, also after `setLayer` moves the node there.
- A sprite on a canvas layer gets no scene-default lit material, and a lit material on one throws, as on a screen layer.
