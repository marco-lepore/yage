# @yagejs/input

## 0.3.0

### Minor Changes

- [#36](https://github.com/marco-lepore/yage/pull/36) [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `InputPlugin` now auto-wires to the current renderer with zero config. When
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

- [#32](https://github.com/marco-lepore/yage/pull/32) [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Route pointer coordinates through the renderer so they land in virtual space.
  - When `InputConfig.rendererKey` is set and the resolved renderer exposes `canvasToVirtual(x, y)`, `InputPlugin` now passes canvas-relative CSS pixels through it before storing them on `InputManager`. Downstream consumers — `getPointerScreenPosition()`, `getPointerPosition()` via `Camera.screenToWorld` — receive correct virtual-space coordinates regardless of fit mode or canvas CSS scaling.
  - `RendererLike` gains an optional `canvasToVirtual?(x, y)` method. Absent implementations (older renderers, custom shims) fall through to the pre-existing raw-CSS-coords path, so this is backward compatible.
  - Fixes a latent bug where pointer coords were wrong whenever the canvas CSS size diverged from virtual size — previously unnoticeable when both matched (the old default), now critical under the renderer's responsive-by-default fit.

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb)]:
  - @yagejs/core@0.3.0
  - @yagejs/debug@0.3.0

## 0.2.0

### Minor Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - `InputManager._setCamera` is now the public `setCamera(camera)`, paired with `clearCamera()`. Games wire the camera in `onEnter` (and clear it in `onExit`) because `CameraEntity` is spawned per-scene; the engine cannot install it at plugin time.
  - `InputConfig.cameraKey` is removed. There is no singleton camera key anymore, so the auto-install path it fed no longer exists.

### Patch Changes

- Updated dependencies [[`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/debug@0.2.0
  - @yagejs/core@0.2.0
