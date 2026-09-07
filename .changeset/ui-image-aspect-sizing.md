---
"@yagejs/ui": minor
---

Size a `UIImage` on one axis and the other axis follows the texture.

- Setting only a `width` or only a `height` gives the element the texture's aspect ratio, so a flex parent's cross-axis stretch no longer squashes the picture. Setting both dimensions stretches the texture to that box; setting neither measures the element at the texture's own pixel size. `flexGrow`, `flex` and `flexBasis` size the main axis too, so an image with one of those set keeps stretching to its box.
- Two shapes that already rendered a full-size picture change with the rule: a sized `height` together with a `maxWidth` shrinks both axes (a 100 x 50 texture at `height: 50, maxWidth: 40` computes 40 x 20), and an axis derived from the texture can overflow a short parent rather than being cut to fit.
- A texture whose width is 0 measures at the fallback ratio of 1 rather than an infinite height.
