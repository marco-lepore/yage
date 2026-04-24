---
"@yagejs/input": minor
---

`InputPlugin` now auto-wires to the current renderer with zero config. When
`InputConfig.rendererKey` is not set, it resolves the new `RendererAdapterKey`
from `@yagejs/core` — the canonical `RendererPlugin` registers itself there,
so `new InputPlugin({ actions: {...} })` just works under responsive fit.

- `InputConfig.rendererKey` stays as an override for custom renderers
  registered under a different `ServiceKey<RendererAdapter>`.
- `RendererLike` is now a re-export alias of `RendererAdapter` from core.
  Existing `import type { RendererLike } from "@yagejs/input"` keeps working.
  Migration note: `RendererLike` is now a `type` alias, not an `interface`,
  so `interface MyRenderer extends RendererLike {}` no longer compiles —
  switch to `type MyRenderer = RendererLike & { ... }` (or import
  `RendererAdapter` directly from `@yagejs/core` and extend that).
  Declaration merging on `RendererLike` is likewise no longer supported.

Register `RendererPlugin` before `InputPlugin` to pick up the auto-wiring.
If input installs first, the resolve returns `undefined` and input falls
back to raw canvas-relative CSS pixels (correct only when canvas CSS size
equals virtual size).
