---
"@yagejs/renderer": minor
---

Component lookup and queries match subclasses, so a base class can name a family.

- `DisplaySystem` runs one query on `[Transform, VisualComponent]` instead of
  one per concrete visual class. Every `VisualComponent` subclass is synced,
  including subclasses declared in other packages, and an entity carrying
  several visuals of different classes has all of them synced and modified
  rather than only the first.
- The sync and modifier passes gate on `effectiveEnabled`, so a visual on a
  dormant entity is skipped. The `innerSort` pass skips a disabled sort group,
  matching its sibling passes.
- Add `FollowTarget` — an `Entity`, a `Transform`, a world point, or a
  function returning one — shared by `CameraFollow`, `CameraComponent.follow`,
  `CameraEntity.follow` and `ScreenFollow`. Entity and Transform targets are
  read through `worldPosition`, so a camera following a target parented under
  a moving platform tracks where the target actually is.
- Breaking: the structural `{ position: Vec2Like }` follow target no longer
  compiles. Pass the `Transform` itself, the entity, or a point.
- `CameraBoundsComponent` declares `static updatePriority = 10`, so the bounds
  clamp sees this frame's position and zoom. An animated zoom-out at a level
  edge no longer shows a few pixels beyond the bounds each frame.
- `setFit({ mode })` keeps the element the fit currently observes instead of
  re-resolving the default host.
- Reading a destroyed `RenderTargetHandle` throws
  `RenderTargetHandle.<member>: the handle is destroyed.` instead of a bare
  `Cannot read properties of null` from inside Pixi.
- `CameraFollow.start`, `CameraZoom.start` and `CameraEntity`'s `fitTo` reject
  a non-finite or out-of-range number at the call, naming the input, instead
  of writing it into camera state where nothing recovers it.
- A throwing layer depth-key function, sort-group `innerSort`, follow-target
  function, zoom easing, transition easing, or mask draw callback is attributed
  to that callback in `Inspector.getErrors().callbackErrors` and rethrown.
- Docs: under `letterbox` every scene layer is clipped to the virtual rect, so
  `extendedVirtualRects` only reports where the bars are — bar content is
  parented on the Pixi stage in canvas pixels. `screenToWorld` /
  `worldToScreen` use the camera's transform, not a layer's. Shake intensity,
  follow offset and deadzone are world pixels; mask coordinates are the masked
  object's local space. There is no `document.body` fit fallback, and the
  default blend mode is `"inherit"`.
