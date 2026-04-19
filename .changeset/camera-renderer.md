---
"@yagejs/renderer": minor
---

pr: 21
commit: 32b35dcc89b5e28fdb852a08127f0a6f06ded819
author: marco-lepore

Rework the camera system into an entity + layer-binding model, and give every scene its own container.

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
