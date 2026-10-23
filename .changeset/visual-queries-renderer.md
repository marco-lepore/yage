---
"@yagejs/renderer": minor
---

Visual components report their size and take pointer listeners, and a texture can mask any visual.

- `VisualComponent.localBounds` returns the box a visual draws in its own pixels, before position, rotation and scale, including while it is hidden.
- `VisualComponent.onPointer(event, fn)` calls `fn` for `"down"`, `"up"`, `"tap"`, `"over"` or `"out"` on the visual, records a throw on the `ErrorBoundary`, and returns a function that removes the listener.
- `textureMask(texture, options)` clips to a texture's alpha channel. The mask owns the sprite that draws the texture.
- Breaking: `spriteMask` is removed. Replace `setMask(spriteMask(sprite))` with `setMask(textureMask(key))`.
