---
"@yagejs/renderer": minor
---

Add a `speed` accessor to `AnimatedSpriteComponent`.

- `speed` (get/set) is the playback rate the component already accepted through `play({ speed })`: frames advanced per tick at 60 fps, default `1`. Writing it retimes the clip that is already running, without restarting playback or moving the current frame. `0` holds the current frame while `isPlaying` stays `true`, and a negative value plays backwards.
- With an `AnimationController` on the entity, `speed` reads the rate the sprite is actually running at, which is the animation definition's `speed` times `controller.speed` times the `playOneShot({ speed })` factor. The controller writes the rate again at its next animation switch and whenever `controller.speed` is written; a running one-shot's lock keeps the duration computed when it started. Use `AnimationController.speed` to retime every animation on the controller, and the component's `speed` to retime only the clip on screen.
- Both entries now reject a non-finite rate: `speed = NaN` and `play({ speed: NaN })` throw naming the offending value, before the write, so the previous rate survives. `play({ speed: Infinity, loop: false })` previously jumped to the last frame and stopped; use `gotoFrame(last)` for that jump.
