---
"@yagejs/input": minor
---

Route pointer coordinates through the renderer so they land in virtual space.

- When `InputConfig.rendererKey` is set and the resolved renderer exposes `canvasToVirtual(x, y)`, `InputPlugin` now passes canvas-relative CSS pixels through it before storing them on `InputManager`. Downstream consumers — `getPointerScreenPosition()`, `getPointerPosition()` via `Camera.screenToWorld` — receive correct virtual-space coordinates regardless of fit mode or canvas CSS scaling.
- `RendererLike` gains an optional `canvasToVirtual?(x, y)` method. Absent implementations (older renderers, custom shims) fall through to the pre-existing raw-CSS-coords path, so this is backward compatible.
- Fixes a latent bug where pointer coords were wrong whenever the canvas CSS size diverged from virtual size — previously unnoticeable when both matched (the old default), now critical under the renderer's responsive-by-default fit.
