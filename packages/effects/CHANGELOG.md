# @yagejs/effects

## 0.11.0

### Minor Changes

- [#303](https://github.com/marco-lepore/yage/pull/303) [`7e500d6`](https://github.com/marco-lepore/yage/commit/7e500d635ebde8d9ef63b073234ee285d9176576) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add advanced visual feedback primitives for Feel cues and direct renderer use.
  - Add deterministic glitch displacement with refreshable band patterns.
  - Add signed zoom blur with host-local centers, radii, and an optional radius
    that expands from the center with intensity.
  - Add symmetric horizontal or vertical axis blur.
  - Add a focused implosion shader with inward pull, darkening, swirl, and an
    optional radius that expands from the center with intensity.
  - Add a noise-driven dissolve shader with a configurable bright edge.
  - Reject non-finite and out-of-range numbers at the call that supplies them,
    across every option, `setIntensity`, and setter on the five new presets. The
    error names the input and the constraint. `implosion` previously clamped
    `radius` and `darkness` silently and now throws instead, which also stops a
    `NaN` from slipping past the clamp into a filter uniform.

### Patch Changes

- [#318](https://github.com/marco-lepore/yage/pull/318) [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Declare `@yagejs/core` as a peer dependency so effect bundles use the
  application's core instance instead of including a second copy.
- Updated dependencies [[`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aa5b78e`](https://github.com/marco-lepore/yage/commit/aa5b78e18b56d17bdca4ffb8299c8ea83979e05a), [`439d0e2`](https://github.com/marco-lepore/yage/commit/439d0e205228bee15d8d79607abdba5731b0873b), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`b64cd45`](https://github.com/marco-lepore/yage/commit/b64cd453a65a83899b9e8d5fecf4ad43bf1eb3d4), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/renderer@0.11.0
  - @yagejs/core@0.11.0

## 0.10.4

## 0.10.3

### Patch Changes

- [#283](https://github.com/marco-lepore/yage/pull/283) [`6dc493e`](https://github.com/marco-lepore/yage/commit/6dc493e32c8a20e928621490c1308f99324e7208) Thanks [@marco-lepore](https://github.com/marco-lepore)! - An engine peer range names the one engine minor the package was built and tested against.
  - The `@yagejs/renderer` peer range is `>=0.10.2 <0.11.0`. It admitted every renderer from 0.3.0 up to 1.0.0 before, which npm read as a promise that any of them would work. Nothing built or ran those combinations, and the oldest are broken outright: the presets call `defineEffect` and are typed against `Effect` and `EffectHandle`, none of which a renderer below 0.4.0 exports.
  - A game holding renderer and effects on different minors now gets a version conflict from npm at install time, instead of an install that resolves a second copy of a shared package and fails later.

## 0.10.2

## 0.10.1

## 0.10.0

## 0.9.0

### Minor Changes

- [#159](https://github.com/marco-lepore/yage/pull/159) [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Change the engine time unit from milliseconds to seconds.

  `Component.update(dt)` / `fixedUpdate(dt)` now receive seconds (~0.0167 at 60fps) instead of milliseconds. `EngineConfig.fixedTimestep` defaults to `1/60` and is expressed in seconds. All duration-based APIs follow: `Process.delay`, `ProcessSlot`/`ProcessComponent.slot` durations, `Tween`/`Sequence.wait`/`Tween.stagger` step, `KeyframeTrack` keyframe `time`, `LoadingScene.minDuration`, scene-transition durations (`fade`/`flash`/`crossFade`/`iris`/`irisReveal`/`chessboard`/`slidePush`), `CameraComponent.shake`/`zoomTo`, `AnimationController.playOneShot`, and effect durations/fades (`hitFlash`, `shockwave`, `fadeIn`/`fadeOut`) are all in seconds.

  Migration: drop any `dt / 1000` conversion in your `update`/`fixedUpdate` code, and pass durations in seconds (e.g. `300` ms becomes `0.3`).

## 0.8.0

## 0.7.0

### Minor Changes

- [#74](https://github.com/marco-lepore/yage/pull/74) [`49a09c0`](https://github.com/marco-lepore/yage/commit/49a09c04b962a54187c62a66ad6dbf61f03c2cb5) Thanks [@marco-lepore](https://github.com/marco-lepore)! - New `colorize` preset — luminance-to-colour recolour via a custom WebGL+WGSL shader pair. Outputs `mix(sourceRGB, tintColor * L, strength)` where `L` is Rec. 601 luminance, so black stays black, white reaches the target colour, midtones blend proportionally, and source alpha is preserved unchanged. The replace-style alternative to `sprite.tint`'s multiply, which turns saturated source colours into mud when the tint is far from the source hue. Options: `{ color: number | string, strength?: number }` (default `strength: 1`); handle: `setColor(color: number | string)`, `setStrength(value: number)` (preserves intensity ratio), plus the base fade/run/setEnabled/remove surface.

## 0.6.0

### Minor Changes

- [#60](https://github.com/marco-lepore/yage/pull/60) [`a30558d`](https://github.com/marco-lepore/yage/commit/a30558d25ca91618cb7ef8855d6a11946f23110e) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add 7 new effect presets: `godRay` (animated volumetric light shafts), `shockwave` (concentric-ring ripple with `trigger(x, y)`), `motionBlur` (directional streak with `setVelocity`), `oldFilm` (sepia + grain + scratches + vignette), `bulgePinch` (lens-distortion bulge or pinch with `setStrength` / `setCenter` / `setRadius`), `halftone` (custom WebGL+WGSL comic-print dot grid), and `wave` (custom WebGL+WGSL horizontal-shimmer distortion). Each preset registers a stable `yage:<name>` string so it round-trips through `SaveService.saveSnapshot` / `loadSnapshot`. Self-animating presets (`godRay`, `oldFilm`, `wave`, plus `shockwave` after `trigger()`) drive their time uniforms through the engine's process scheduler, so they pause with the owning scene and time-scale with it.

## 0.5.0

## 0.4.0

### Minor Changes

- [#44](https://github.com/marco-lepore/yage/pull/44) [`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Effects preset package + handle-based save/load for effects and masks.
  - New `@yagejs/effects` package: ten hero presets — `hitFlash`, `bloom`, `outline`, `dropShadow`, `pixelate`, `glow`, `crt`, `chromaticAberration`, `vignette`, `colorGrade`. Each preset registers under a stable `yage:<name>` string via `defineEffect` so it survives save/load.
  - Renderer: new `defineEffect` / `defineMask` registries; `EffectStack.serialize` / `restoreFrom`; `MaskHandle.serialize`; `restoreMask` helper. The 4 visual components now persist their effects + mask through `serialize` / `afterRestore`. A `RendererSnapshotContributor` is auto-registered with `SaveService` (when present) to cover layer / scene / screen-scope effects + masks.
  - Save: new `SnapshotContributor` extension hook (`registerSnapshotExtra` / `unregisterSnapshotExtra`) so plugins can extend `GameSnapshot.extras`. Snapshot version bumped 3 → 4 — older saves no longer load.

  `rawFilter`, `spriteMask`, and `graphicsMask` skip serialization with a one-shot warning since they have no string identity to record. In-flight `fadeIn` / `fadeOut` tweens are not preserved across save/load.
