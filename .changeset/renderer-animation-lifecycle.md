---
"@yagejs/renderer": minor
---

Signal interrupted one-shots, validate animation names and sheet grids, and stop forcing nearest sampling.

- Add `onCancel` to `playOneShot` options on `AnimationController` and
  `LayeredAnimationController`. Exactly one of `onComplete` and `onCancel`
  runs per one-shot: `onComplete` when the lock plays out, `onCancel` when a
  second one-shot, `forcePlay()`, `unlock()` or destroying the component ends
  it first. A game can now release what the one-shot was holding instead of
  losing the callback silently. A cancel callback runs after the new state is
  installed, so calling `playOneShot` from inside it takes effect.
- `play`, `playOneShot`, `forcePlay` and `calcDuration` throw naming the
  method, the unknown name and the defined set instead of failing with a
  `TypeError` and leaving the controller reporting an animation it is not
  drawing. Add `AnimationController.has(name)` to ask first when names come
  from data.
- `LayeredAnimationController.play`, `playOneShot` and `forcePlay` throw
  naming the layer that lacks the animation before any layer switches, so the
  layers can no longer end up on different animations. `playOneShot` checks the shared
  `startFrame` and `speed` against every layer the same way, an explicit
  duration included, which matters when layers define the same name with
  different frame counts.
- Add `startFrame` and `speed` to `playOneShot` (and to `calcDuration`). The
  automatic lock duration is derived from the frames that will actually play,
  so the lock and the visible clip end together.
- Add `AnimatedSpriteComponent.onFrameChange(listener)`, a multi-subscriber
  subscription returning an unsubscribe function. It owns Pixi's single
  frame-change slot, which one raw assignment used to take for itself.
- `AnimatedSpriteComponent.play()` owns its `onComplete`: a play without one
  clears the previous callback, and an animation switch clears it too, so it
  cannot fire for an animation its author never saw.
- Move the grid validation into the step every slicing entry shares.
  `sliceGrid`, `sliceSheet` and `sliceTextureFrames` now check that each field
  is a finite number at or above its minimum, that `columns` and `count` are
  whole numbers, and that the grid fits inside the texture, throwing naming
  the function and the offending field. A
  `frameWidth` of 0 previously derived an infinite frame count and looped
  forever; an oversize grid produced frames that read past the image.
- Sheet slicing no longer switches the shared texture source to nearest
  sampling. That mutation re-sampled every other sprite cut from the same
  file, including smooth art. Turn on `pixelArtPreset` in the renderer config
  for nearest sampling.
- An atlas animation with no frames throws naming the atlas and the animation,
  instead of failing inside Pixi's `AnimatedSprite` constructor.
- Re-baking a bitmap font clears the previous bake's bold/italic
  registrations even when the new bake supplies no variants, so a stale
  emphasis atlas no longer keeps resolving.
- Route the animation callbacks the engine invokes — `onComplete`, `onCancel`
  and frame listeners — through the error boundary, so a throw is recorded
  against the callback in `Inspector.getErrors().callbackErrors`.
