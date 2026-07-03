---
"@yagejs/core": minor
---

`RendererAdapter` gains an optional `visibleVirtualRect` — the on-screen region of virtual space clamped to the declared virtual rect, fresh per access. Renderer-agnostic screen-space overlays lay out against it instead of mapping canvas corners through `canvasToVirtual`: under letterbox fit the corners extend into the masked bars, where drawn content is clipped invisible while pointer input still lands. `RendererPlugin` already exposes the getter and now declares the adapter interface, so the member is compile-checked.
