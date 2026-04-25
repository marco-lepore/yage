# @yagejs/renderer

## 0.3.0

### Minor Changes

- [#32](https://github.com/marco-lepore/yage/pull/32) [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `expand` fit mode plus canvas/visible geometry API.

  The existing `cover` uses CSS-cover semantics — it scales by `max` and crops the declared virtual rect on the long axis. For most games that's wrong: aspect ratio changes what the player can see. `expand` is the game-friendly alternative, matching Godot's `stretch/aspect=expand`, Unity's `Screen Match Mode=Expand`, and Construct 3's "Scale inner": virtual is always fully visible (same scale/offset as `letterbox`), but the leftover canvas space is the game's to draw into — fog, parallax, decorative backdrop, bar-anchored HUD — rather than painted with the background color.
  - `FitMode` adds `"expand"`. Geometry is identical to `letterbox`; the difference is rendering convention.
  - New `virtualCanvasRect: CanvasRect` — where the declared virtual rect sits on the canvas, in CSS pixels. Useful for DOM overlays positioned over the play area, cropping screenshots to gameplay, and mapping CSS-coord hit regions. `CanvasRect` is a new alias of `VirtualRect` so signatures signal which coordinate space a rect is in.
  - New `visibleCanvasRect: VirtualRect` — full canvas extent in virtual-space pixels, **not clamped** to the declared virtual rect. Under `letterbox`/`expand` on an off-aspect host it extends past virtual on the bar axis. Under `cover` it equals `visibleVirtualRect`; under `stretch` it equals the virtual rect. Iterate against it for backdrops that must fill the entire visible canvas, or anchor HUDs to the canvas corners instead of the play-area corners.
  - New `extendedVirtualRects: readonly VirtualRect[]` — the complement of `virtualRect` inside `visibleCanvasRect`: 0–2 strips of visible canvas that sit outside the virtual rect, in virtual-space pixels. Populated under `letterbox` and `expand` when aspect mismatches; empty under `cover` and `stretch`. Drives fog-over-bars under `expand` and also describes where the `backgroundColor` bars live under `letterbox` (useful for future bar customization).
  - New `virtualToCanvas(x, y): Vec2` forward transform, symmetric with the existing `canvasToVirtual`.
  - The `responsive-ui` example is rewritten against `expand`: grid extends across the full visible canvas, fog overlays the bars via `extendedVirtualRects`, and HUD corners anchor to `visibleCanvasRect` so cards land in the bars under off-aspect viewports. The fog/mask hack around `croppedVirtualRects` is gone.

  Non-breaking: `letterbox` / `cover` / `stretch` keep their existing semantics and geometry. Existing code that reads `visibleVirtualRect` or `croppedVirtualRects` keeps working unchanged.

- [#32](https://github.com/marco-lepore/yage/pull/32) [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Responsive canvas fit by default — the renderer now tracks its host element and re-maps the virtual rectangle on every resize.
  - `RendererConfig.fit` is an optional override taking `{ mode: "letterbox" | "cover" | "stretch"; target?: HTMLElement }`. When omitted, the renderer defaults to `{ mode: "letterbox" }` against the configured `container` (or `canvas.parentElement`). If neither resolves, the controller applies a one-shot transform against the initial `width × height` and installs no observer — opt in to full-page fit via `fit: { target: document.body }`. There is no "no-fit" code path anymore; fixed-size canvases are achieved by giving the container fixed CSS dimensions.
  - `letterbox` preserves aspect inside the host with bars in `backgroundColor`. `cover` preserves aspect and fills (overflowing on one axis). `stretch` applies non-uniform scale.
  - Runtime control on `RendererPlugin`: `setFit(options)` swaps modes/targets, the `fit` getter returns the current options, `canvasSize` returns the current CSS size.
  - New `canvasToVirtual(x, y)` inverts the current stage transform — CSS pixels relative to the canvas top-left → virtual-space pixels. Name chosen to avoid clashing with the engine's existing "screen space" terminology (which means virtual viewport space, not DOM pixels).
  - New `visibleVirtualRect` getter returns the on-screen sub-rect of virtual space (clamped to virtual bounds). Under `letterbox` / `stretch` it equals the full virtual rect; under `cover` it narrows on the long axis so HUDs can anchor to what players actually see while gameplay keeps using the full declared play area. `VirtualRect` is exported.
  - New `croppedVirtualRects` getter returns the complement: 0–2 strips of virtual space that are currently off-screen. Empty under `letterbox` / `stretch`; under `cover` returns the top+bottom or left+right crop strips. Lets effects reason about what's beyond the visible edge — fog-of-war overlays at the crop boundary, off-screen-activity indicators, auto-panning cameras.
  - Implementation uses `app.renderer.resize(hostW, hostH)` so hi-DPI stays correct via `resolution` + `autoDensity`, paired with a recomputed `stage.scale` / `stage.position` per mode.
  - Teardown is wired into `onDestroy`: the `ResizeObserver` is disconnected before `app.destroy()`. Headless environments (no DOM target, no `document`) fall back to a one-shot transform against the initial `width × height` and install no observer.

### Patch Changes

- [#36](https://github.com/marco-lepore/yage/pull/36) [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `RendererPlugin` now also registers itself under the new cross-package
  `RendererAdapterKey` (from `@yagejs/core`). This wires up `@yagejs/input`
  automatically — pointer events target the canvas and coordinates route
  through `canvasToVirtual` without any `rendererKey` config on `InputPlugin`.
  No behavior change for existing code that read `RendererKey` directly.
- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb)]:
  - @yagejs/core@0.3.0

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
