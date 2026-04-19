---
"@yagejs/renderer": minor
"@yagejs/input": minor
"@yagejs/ui": minor
"@yagejs/ui-react": patch
"@yagejs/debug": patch
"@yagejs/core": patch
"@yagejs/physics": patch
"@yagejs/audio": patch
"@yagejs/particles": patch
"@yagejs/tilemap": patch
"@yagejs/save": patch
"create-yage": patch
---

Rework the camera system into an entity + layer-binding model, and give every scene its own container.

**`@yagejs/renderer`**

- The `Camera` class and its service key are removed. Cameras are now entities: `this.spawn(CameraEntity, { position, zoom, rotation, bindings, follow, ... })`. The entity composes `CameraComponent` + `CameraFollow` + `CameraShake` + `CameraZoom` + `CameraBoundsComponent`, all individually addressable via `entity.get(...)`.
- `CameraEntity` exposes a flat proxy API (`cam.position`, `cam.zoom`, `cam.follow()`, `cam.shake()`, `cam.zoomTo()`, `cam.bounds`) so day-to-day usage doesn't need to reach into components.
- Cameras bind to named layers. A `CameraEntity` without `bindings` auto-binds every declared `LayerDef` on the scene; explicit `bindings` take an array of `{ layer, translateRatio? }` for parallax. `translateRatio` scales only the translation vector — zoom and rotation still apply at full strength.
- `DisplaySystem` now iterates every live scene's render tree, resets each layer to identity every frame, and applies enabled cameras sorted by `priority` (highest wins on overlap). Disabling or destroying the last camera on a scene leaves its layers on identity instead of frozen mid-transform.
- `CameraComponent.screenToWorld` / `worldToScreen` now factor `cam.rotation` into the conversion, matching the rotation actually applied to the layer container.
- `CameraComponent.viewportWidth` / `viewportHeight` are live getters reading from `RendererKey.virtualSize`, not values snapshotted in `onAdd()`, so world↔screen conversions stay correct after a renderer resize.
- `CameraBoundsComponent` centers the camera on the bounds rectangle when the viewport is larger than the bounds, instead of clamping to an inverted range.
- New `CameraShake.stop()` cancels an active shake immediately; decayed intensity is clamped at zero so `decay > 1` no longer inverts the final frames.
- Each scene now owns a single `Container` (`SceneRenderTree.root`) under the stage. `SceneRenderTreeProvider` adds `getTree(scene)` and `allTrees()`, and `bringSceneToFront(scene)` reorders one root instead of every layer.
- `LayerDef.space` and `LayerDef.eventMode` are removed. Layers are camera-followable by default; plugins provision screen-space layers via `tree.ensureLayer(def, { autoBindable: false })`. `EnsureLayerOptions` is a new public type.
- `CameraKey`, `StageKey`, and `WorldRootKey` are removed. Plugins that need the scene's root container call `provider.getTree(scene).root`.

**`@yagejs/input`**

- `InputManager._setCamera` is now the public `setCamera(camera)`, paired with `clearCamera()`. Games wire the camera in `onEnter` (and clear it in `onExit`) because `CameraEntity` is spawned per-scene; the engine cannot install it at plugin time.
- `InputConfig.cameraKey` is removed. There is no singleton camera key anymore, so the auto-install path it fed no longer exists.

**`@yagejs/ui`**

- `UIPanel` auto-provisions a `"ui"` layer via `ensureLayer({ autoBindable: false })` when the scene didn't declare one, keeping UI in screen-space without any camera wiring.
- Adding a `UIPanel` to a layer that would be auto-bound by the default camera now throws with a pointer at how to fix it (remove the layer from `Scene.layers`, or pass explicit `CameraEntity { bindings }` that exclude it). This prevents the surprise of UI scrolling with the world.
- `layer.container.eventMode = "static"` is applied whether UIPanel creates the layer or reuses an existing opted-out one, so HUD hit-testing works in both cases.

**`@yagejs/ui-react`**

- `UIRoot` refuses to mount if its default layer is camera-auto-bindable, with the same error guidance as `UIPanel`.

**`@yagejs/debug`**

- `DebugScene` declares its layers without `space`; the overlay now uses the same auto-binding model as user scenes.
- `DebugRenderSystem` factors `cam.rotation` into the world-container translation, matching the main `DisplaySystem`.
- `findTopmostCamera` returns the highest-priority **enabled** camera on the topmost scene with one, matching `DisplaySystem`'s own selection rules instead of picking whichever camera happened to be found first.
