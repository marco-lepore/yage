---
"@yagejs/core": minor
"@yagejs/renderer": minor
---

Core lifecycle ergonomics: animation fan-out, Transform first-read, scene reentrancy.

**`@yagejs/renderer` — `LayeredAnimationController`**

New helper component for multi-layer characters (head + body + outfit). Takes
a list of sibling `AnimationController` instances and fans `play()` /
`playOneShot()` across all of them with a single shared lock timer. The
shared duration is computed once (from the first controller, or an explicit
`duration` option) and passed to each child as `options.duration`, so every
layer unlocks on the same frame regardless of per-layer frame counts. The
master `onComplete` fires exactly once.

`AnimationController.playOneShot` now accepts a per-call `duration` override
on solo controllers too (the auto-computed wall-clock value is still the
default). Doc comment clarifies the canonical pattern for narrowing
`AnimationController<T>` through `entity.get()` / `sibling()`.

**`@yagejs/core` — `KeyframeAnimator`**

`KeyframeAnimationDef.setter` is now optional — omit it for pure-timeline
tracks that fire only keyframe `event` callbacks (cutscene beats, audio
cues). Also declared with method syntax so a
`Record<string, KeyframeAnimationDef<number>>` literal flows into the
constructor unchanged, without per-key `as` casts or builder helpers
(previously failed on setter parameter contravariance under
`strictFunctionTypes`).

**`@yagejs/core` — `Transform`**

The constructor leaves `_dirty = true` so the first `worldPosition` /
`worldRotation` / `worldScale` read recomputes against whatever parent chain
`addChild` has established by then. Previously, an unparented read before
parenting completed would lock in a stale local-as-world value.

**`@yagejs/core` — `SceneManager` reentrancy**

`push`, `pop`, `replace`, and `popAll` are now safe to call from inside a
scene lifecycle hook (`onEnter`, `onExit`, `onPause`, `onResume`,
`beforeEnter`, `afterExit`). The call is queued on the manager's internal
pending chain and runs after the current mutation finishes; the returned
promise resolves when the deferred op completes. The previous throw is
replaced with a dev-only `console.warn` so the smell still surfaces in
development without breaking the (legitimate) "skip the title scene if a
save exists" pattern.
