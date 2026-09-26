---
"@yagejs/core": patch
---

Add `bounds` to every node of the Inspector's user-interface snapshot.

`layout` carries Yoga's parent-relative box, which cannot locate an element on
the canvas: a surface anchored to the bottom right applies that anchor to its
container rather than to Yoga, so summing offsets down the tree reports
top-left coordinates. `bounds` maps the four corners of the element's own box
into virtual-space pixels and reports the axis-aligned box around them, so a
test can read where a button sits on screen, and a scaled or rotated element
reports the area it covers.

```ts
const root = window.__yage__.inspector.snapshot().scenes[0]?.ui?.root;
root?.children[0]?.bounds; // { x: 200, y: 150, width: 60, height: 30 }
```

`bounds` is `null` when no renderer adapter is registered, or for an element
that owns no container. Values are rounded to a thousandth of a pixel, so one
box reads the same at every canvas size and a snapshot diff stays meaningful.
