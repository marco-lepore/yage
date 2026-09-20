---
"@yagejs/renderer": patch
---

`GraphicsComponent` takes a `pivot` option: the point of the drawing, in the drawing's own pixels, that sits on the entity position and that rotation and scale act about.

```ts
// The circle's centre sits on the entity, so the barrel rolls in place.
entity.add(
  new GraphicsComponent({ layer: "world", pivot: { x: 0, y: -24 } }).draw(
    (g) => {
      g.circle(0, -24, 24).fill(0x8b5a2b);
    },
  ),
);
```

It is the Graphics counterpart of the `anchor` that Sprite, AnimatedSprite, Text and SplitText take, measured in pixels rather than as a fraction because a drawing has no texture size. Both numbers must be finite; a `NaN` throws naming the component and the coordinate. The default, `{ x: 0, y: 0 }`, is the origin the `draw` callback draws around.

The renderer and core documentation state which point a rotation acts about: the entity's own position, for the entity's own space and for every descendant, with `anchor` or `pivot` choosing which point of the art lands there.
