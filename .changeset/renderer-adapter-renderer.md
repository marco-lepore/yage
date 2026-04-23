---
"@yagejs/renderer": patch
---

`RendererPlugin` now also registers itself under the new cross-package
`RendererAdapterKey` (from `@yagejs/core`). This wires up `@yagejs/input`
automatically — pointer events target the canvas and coordinates route
through `canvasToVirtual` without any `rendererKey` config on `InputPlugin`.
No behavior change for existing code that read `RendererKey` directly.
