# @yagejs/effects

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
