# @yagejs/renderer

## 0.2.0

### Minor Changes

- [#30](https://github.com/marco-lepore/yage/pull/30) [`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Two additions for world-space UI and layer decoupling.

  **`ScreenFollow` component.** Each frame projects a world source through a camera and writes the resulting screen coord to this entity's `Transform.worldPosition`. The canonical billboard primitive: pair with `UIPanel` / `UIRoot` on a screen-space layer using `positioning: "transform"` to produce entity-anchored UI (nameplates, health bars, damage numbers) that tracks a target while staying axis-aligned and constant-size under any camera zoom or rotation. `target` accepts an `Entity`, a static `Vec2Like`, or a function returning a `Vec2Like` — for midpoints, animated paths, or arbitrary world sources. `offset` is in screen pixels, applied _after_ projection (`cam.worldToScreen(target) + offset`), so the visual gap between UI and target stays fixed under any camera zoom or rotation.

  **`CameraBinding` gains two new per-axis ratios** alongside the existing `translateRatio`: `rotateRatio` and `scaleRatio`. All three default to `1` (full camera effect), so existing parallax bindings are unchanged.
  - `rotateRatio: 0` — the bound layer stays upright regardless of camera rotation.
  - `scaleRatio: 0` — the bound layer stays at unit scale regardless of camera zoom.
  - Values in between blend linearly.

  These are **layer-level decoupling primitives** — useful for parallax, minimaps, and camera-agnostic world overlays. They are NOT the right answer for entity-anchored UI (use `ScreenFollow` + `positioning: "transform"` for that). The math in `DisplaySystem.applyCameraTransforms` reduces to the previous implementation exactly when all three ratios are `1`, so nothing changes for cameras that don't opt in.

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - The `Camera` class and its service key are removed. Cameras are now entities: `this.spawn(CameraEntity, { position, zoom, rotation, bindings, follow, ... })`. The entity composes `CameraComponent` + `CameraFollow` + `CameraShake` + `CameraZoom` + `CameraBoundsComponent`, all individually addressable via `entity.get(...)`.
  - `CameraEntity` exposes a flat proxy API (`cam.position`, `cam.zoom`, `cam.follow()`, `cam.shake()`, `cam.zoomTo()`, `cam.bounds`) so day-to-day usage doesn't need to reach into components.
  - Cameras bind to named layers. A `CameraEntity` without `bindings` auto-binds every declared `LayerDef` on the scene; explicit `bindings` take an array of `{ layer, translateRatio? }` for parallax. `translateRatio` scales only the translation vector — zoom and rotation still apply at full strength.
  - `DisplaySystem` now iterates every live scene's render tree, resets each layer to identity every frame, and applies enabled cameras sorted by `priority` (highest wins on overlap). Disabling or destroying the last camera on a scene leaves its layers on identity instead of frozen mid-transform.
  - `CameraComponent.screenToWorld` / `worldToScreen` now factor `cam.rotation` into the conversion, matching the rotation actually applied to the layer container.
  - `CameraComponent.viewportWidth` / `viewportHeight` are live getters reading from `RendererKey.virtualSize`, not values snapshotted in `onAdd()`, so world↔screen conversions stay correct after a renderer resize.
  - `CameraBoundsComponent` centers the camera on the bounds rectangle when the viewport is larger than the bounds, instead of clamping to an inverted range.
  - New `CameraShake.stop()` cancels an active shake immediately; decayed intensity is clamped at zero so `decay > 1` no longer inverts the final frames.
  - Each scene now owns a single `Container` (`SceneRenderTree.root`) under the stage. `SceneRenderTreeProvider` adds `getTree(scene)` and `allTrees()`, and `bringSceneToFront(scene)` reorders one root instead of every layer.
  - `LayerDef.eventMode` is removed. `LayerDef.space: "world" | "screen"` (default `"world"`) controls whether cameras auto-bind the layer — world-space layers scroll/zoom with the camera, screen-space layers stay fixed to the viewport. Plugins provision screen-space layers via `tree.ensureLayer(def, { space: "screen" })`. `EnsureLayerOptions` and the `LayerSpace` union are new public types.
  - `CameraKey`, `StageKey`, and `WorldRootKey` are removed. Plugins that need the scene's root container call `provider.getTree(scene).root`.

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add scene-scoped DI and generic scene hooks.
  - `SceneRenderTreeKey` is now scene-scoped. `SceneRenderTree`, `SceneRenderTreeProvider`, and `LayerDef` are new public exports.

- [#22](https://github.com/marco-lepore/yage/pull/22) [`083b05b`](https://github.com/marco-lepore/yage/commit/083b05bd9c9557ef32b9b82939e792983c4a5f9b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add scene transition system with push/pop/replace support, and rework the scene-manager cancellation story.
  - `fade({ duration?, color? })` — fade to solid color and back. Incoming scene hidden until mid-point; outgoing scene hidden at mid-point on pop.
  - `flash({ duration?, color? })` — flash overlay with linear decay. Opaque at begin masks the scene swap.
  - `crossFade({ duration? })` — cross-dissolve between scenes (both visible throughout). `end()` now leaves the outgoing container's alpha at 0 on pop/replace to avoid a one-frame flash between `end()` and the stack mutation.
  - `getSceneContainer(ctx, scene)` — helper for custom transitions, resolves a scene's PIXI root container. All transition exports are also re-exported through `@yagejs/renderer`'s top-level barrel.

### Patch Changes

- [#29](https://github.com/marco-lepore/yage/pull/29) [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Migrate `DisplaySystem`'s defensive `entity.scene` null check to the new `entity.tryScene` introduced in `@yagejs/core`. No behavior change.

- Updated dependencies [[`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/core@0.2.0
