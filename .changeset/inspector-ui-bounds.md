---
"@yagejs/core": patch
---

Add `bounds` to every node of the Inspector's user-interface snapshot.

`layout` carries Yoga's parent-relative box, which cannot locate an element on
the canvas: a surface anchored to the bottom right applies that anchor to its
container rather than to Yoga, so summing offsets down the tree reports
top-left coordinates. `bounds` maps the element's own container into
virtual-space pixels, so a test can read where a button sits on screen.

```ts
const root = engine.inspector.snapshot().scenes[0]?.ui?.root;
root?.children[0]?.bounds; // { x: 200, y: 150, width: 60, height: 30 }
```

`bounds` is `null` when no renderer adapter is registered, or for an element
that owns no container. A rotated element reports the axis-aligned box of two
mapped corners, which is approximate.
