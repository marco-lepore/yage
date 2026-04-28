# @yagejs/ui

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `UIPanel` is now `@serializable`. `LoadingSceneProgressBar` records its constructor options on setup and round-trips through `serialize()` / `fromSnapshot()` so it survives save/load and inspector snapshot diffs.

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

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - `UIPanel` auto-provisions a `"ui"` layer via `ensureLayer(def, { space: "screen" })` when the scene didn't declare one, keeping UI pinned to the viewport without any camera wiring.
  - `UIPanel` can now target a world-space layer deliberately — declare a `LayerDef` with `space: "world"` (the default) and pass its name via `UIPanelOptions.layer` to get diegetic UI that follows the camera (interaction prompts, entity-anchored health bars, damage numbers). The previous throw that rejected UI on camera-auto-bindable layers is gone; the layer's declared `space` is now the single source of truth.
  - `layer.container.eventMode = "static"` is applied whether UIPanel creates the layer or reuses an existing one, so HUD hit-testing works in both cases.

- [#26](https://github.com/marco-lepore/yage/pull/26) [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `LoadingSceneProgressBar` — default visual for `@yagejs/core`'s `LoadingScene`.
  - Entity subclass. Spawn it inside a `LoadingScene` from `onEnter` (throws otherwise).
  - Subscribes to `scene:loading:progress` on the engine event bus and updates a `UIProgressBar`.
  - Customizable: `width`, `height`, `track`, `fill`, `anchor`, `offset`, `layer`.
  - Optional `backdrop` for a full-viewport background behind the bar — recommended whenever the loading scene is used with a transition, otherwise the outgoing scene bleeds through during the fade. Implemented as a sibling entity whose lifetime is tied to the progress bar.
  - For custom visuals (spinners, animated text, etc.), write a component that subscribes to the same event — same idiom this widget uses internally.

- [#30](https://github.com/marco-lepore/yage/pull/30) [`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `UIPanelOptions.positioning` for Transform-driven panel positioning.
  - `positioning: "anchor"` (default) — unchanged; `anchor` resolves against the viewport (`virtualSize`). Existing HUDs and menus keep working as-is.
  - `positioning: "transform"` — panel is positioned at `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is reinterpreted as the pivot on the panel itself (e.g. `Anchor.BottomCenter` → panel's bottom-center sits at the Transform). Throws at add time if the entity has no `Transform`.

  The option is orthogonal to the layer's `space`, which lets two patterns fall out:
  - **Screen-space layer + `positioning: "transform"`** — pair with `ScreenFollow` from `@yagejs/renderer` (writes `cam.worldToScreen(target) + offset` to the Transform each frame; offset is in screen pixels, applied post-projection) for entity-anchored UI that stays axis-aligned and constant-size under camera zoom / rotation. The new `world-ui` example demonstrates this with nameplates and health bars.
  - **World-space layer + `positioning: "transform"`** — for genuinely diegetic UI (signs in the world, in-game displays) that scales and rotates with the camera like any other world object.

  Also exports a new `pivotOffsetFromAnchor(anchor, pw, ph)` helper alongside `resolveAnchor`, and the `UIPositioning` type.

### Patch Changes

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Adopt scene-scoped DI.
  - `UIPanel` resolves its layer through `SceneRenderTreeKey` (scene-scoped) instead of the removed `UILayerManagerKey`.

- Updated dependencies [[`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/renderer@0.2.0
  - @yagejs/core@0.2.0
