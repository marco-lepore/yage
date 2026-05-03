# @yagejs/debug

## 0.5.0

### Minor Changes

- [#54](https://github.com/marco-lepore/yage/pull/54) [`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `DebugPlugin` `startFrozen` option for true frame-zero determinism.

  `new DebugPlugin({ startFrozen: true })` stops Pixi's ticker during plugin
  `install()` — _before_ `Engine.start()` calls `loop.start()` — and brings
  up the `DebugClock` already in frozen state. Pair with `deterministicSeed`
  for E2E replay.

  **Why:** previously the recommended pattern was `await engine.start();
inspector.time.freeze();`. Pixi auto-starts the ticker inside
  `Application.init()` (which `RendererPlugin.install` awaits), so any frame
  that ticked between then and the user-space `freeze()` mutated physics /
  input clocks non-deterministically. Snapshots taken right after the
  freeze were therefore _not_ bit-identical across runs — visible as a flaky
  `inspector-determinism.spec.ts` on slow CI runners.

  `startFrozen` closes the window: by the time `onStart()` runs and the user
  ever sees `await engine.start()` resolve, the engine has ticked zero
  frames. `inspector.time.thaw()` resumes auto-mode normally.

  Updated `examples/src/platformer.ts` to read `__YAGE_START_FROZEN__` into
  `startFrozen` instead of calling `freeze()` after `engine.start()`.

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/renderer@0.5.0
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `DebugPlugin` now wires the manual `DebugClock` into `Inspector.attachTimeController(...)` so `inspector.time.freeze()/step()` works while the plugin is active, and turns on event-log recording via `inspector.setEventLogEnabled(true)` during `onStart`.
  - `DebugConfig.deterministicSeed?: number` opt-in: when set, every scene's RNG is initialized to this seed via `inspector.setDefaultSceneSeed(...)`. Leave undefined for normal debug builds; set it from test fixtures so replays start from a known RNG state. The previous unconditional fixed seed is gone.
  - Renderer-aware diagnostics (`getLayerTransform`, `getCameraStack`) are now published via `inspector.addExtension("debug", ...)` and exposed as `DebugDiagnostics` — fetch with `inspector.getExtension<DebugDiagnostics>("debug")`. The plugin removes the extension on `onDestroy`, so they no longer leak past plugin teardown.
  - The `Period` step hotkey advances one frame through the same `DebugClock` the inspector uses, keeping the manual timeline coherent across hotkey + programmatic stepping.

### Patch Changes

- Updated dependencies [[`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`08efa94`](https://github.com/marco-lepore/yage/commit/08efa94a8be02ba56c1df9d3bed643abcc1d7159)]:
  - @yagejs/renderer@0.4.0
  - @yagejs/core@0.4.0

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
