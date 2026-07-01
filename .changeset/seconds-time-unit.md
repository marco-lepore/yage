---
"@yagejs/core": minor
"@yagejs/renderer": minor
"@yagejs/physics": minor
"@yagejs/particles": minor
"@yagejs/effects": minor
"@yagejs/debug": minor
"@yagejs/input": minor
---

Change the engine time unit from milliseconds to seconds.

`Component.update(dt)` / `fixedUpdate(dt)` now receive seconds (~0.0167 at 60fps) instead of milliseconds. `EngineConfig.fixedTimestep` defaults to `1/60` and is expressed in seconds. All duration-based APIs follow: `Process.delay`, `ProcessSlot`/`ProcessComponent.slot` durations, `Tween`/`Sequence.wait`/`Tween.stagger` step, `KeyframeTrack` keyframe `time`, `LoadingScene.minDuration`, scene-transition durations (`fade`/`flash`/`crossFade`/`iris`/`irisReveal`/`chessboard`/`slidePush`), `CameraComponent.shake`/`zoomTo`, `AnimationController.playOneShot`, and effect durations/fades (`hitFlash`, `shockwave`, `fadeIn`/`fadeOut`) are all in seconds.

Migration: drop any `dt / 1000` conversion in your `update`/`fixedUpdate` code, and pass durations in seconds (e.g. `300` ms becomes `0.3`).
