# @yagejs/debug

## 0.3.0

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4)]:
  - @yagejs/core@0.3.0
  - @yagejs/renderer@0.3.0

## 0.2.0

### Minor Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Expose camera and layer diagnostics on `window.__yage__.inspector`.
  - `inspector.getLayerTransform(sceneName, layerName)` returns the current `{ x, y, scaleX, scaleY, rotation }` of a scene's layer container, or `undefined` if the scene or layer is missing.
  - `inspector.getCameraStack()` returns one entry per `CameraComponent` in the scene stack: `{ scene, name, priority, enabled }`.

  Both are registered by `DebugPlugin` when it installs, so E2E suites and tools no longer need fixture-local helpers to read back camera/layer state.

### Patch Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - `DebugScene` declares its layers without `space`; the overlay now uses the same auto-binding model as user scenes.
  - `DebugRenderSystem` factors `cam.rotation` into the world-container translation, matching the main `DisplaySystem`.
  - `findTopmostCamera` returns the highest-priority **enabled** camera on the topmost scene with one, matching `DisplaySystem`'s own selection rules instead of picking whichever camera happened to be found first.

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Adopt scene-scoped DI.
  - `DebugPlugin` now mounts a detached `DebugScene` through `SceneManager._mountDetached`, routing the overlay through the same scoped-DI lifecycle and per-scene render tree as stacked scenes while staying off the user-visible stack.

- Updated dependencies [[`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/renderer@0.2.0
  - @yagejs/core@0.2.0
