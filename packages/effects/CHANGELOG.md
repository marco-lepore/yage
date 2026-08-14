# @yagejs/effects

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
