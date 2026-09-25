---
"@yagejs/ui": minor
---

A laid-out element can scale and rotate about a point of its own choosing, and be drawn over its siblings.

- Every element takes four new props, also get/set accessors on each element class: `transformOrigin` (the point to scale and rotate about, as fractions 0–1 of the element's computed size, default `0`), `scale` (a number or `{ x, y }`, default `1`), `rotation` (radians) and `zIndex` (draw and pointer order among siblings, default `0`).
- The props change how an element is drawn, never its layout box: siblings stay put, a container with `overflow: "hidden"` clips at its own edge, and a `UIScrollView` scrolls by the layout box.
- A custom element extends `UIElementBase` to take the four props, and a custom container places each child with `placeElement`.
- Focus movement and tooltips use the box an element is drawn in, so a scaled or rotated element is found where the player sees it. An element inside a container scaled to 0 is skipped.
- Breaking: the `displayObject` of `UIImage` and of the `@pixi/ui` wrappers is a plain container around the picture or widget.
- Breaking: `UIImage.container` is renamed `sprite`.
- Breaking: a wrapper's `focusOutlineBox()` returns a box in the element's own space; `fromViewSpace()` maps a box measured on the widget view into it.
- Breaking: `PixiFancyButtonProps.scale` is removed; the element's `scale` covers it.
