---
"@yagejs/renderer": minor
---

Explicit camera `bindings` override the auto-bound world layers instead of replacing them, so giving one layer its own parallax ratio no longer means restating every other layer in the scene.

A camera binds every `space: "world"` layer at full strength. Each entry in `bindings` replaces the binding for the layer it names; an entry naming a screen-space layer, or a layer the scene tree does not hold yet, is added. Bindings resolve once per camera per frame, so a world layer created after the camera spawned is bound on the next frame.

`CameraComponentOptions.autoBind` and `CameraEntityParams.autoBind` (default `true`) restore exact-list binding: with `autoBind: false` the camera drives the layers `bindings` names and nothing else. That is the only way to leave a world-space layer untransformed — a binding with `translateRatio`, `rotateRatio` and `scaleRatio` all at `0` stops the layer following the camera but puts its origin at the viewport centre.

A camera that was given a partial `bindings` list to restrict which layers it drives now also drives every other world-space layer. Add `autoBind: false` to that camera to keep the old result.
