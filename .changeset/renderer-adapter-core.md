---
"@yagejs/core": minor
---

Add `RendererAdapterKey` — a cross-package contract for "something that owns
a canvas and can map canvas-relative CSS pixels into virtual-space pixels".
The canonical `@yagejs/renderer` plugin registers itself under this key, and
`@yagejs/input` resolves it automatically so pointer events target the
correct canvas and coordinates route through `canvasToVirtual` out of the
box. Foreign renderers can implement `RendererAdapter` and register under
the same key to integrate with `@yagejs/input` without pulling in
`@yagejs/renderer`.

New exports: `RendererAdapterKey`, `RendererAdapter`.
