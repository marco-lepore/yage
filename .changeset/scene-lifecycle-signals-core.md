---
"@yagejs/core": minor
---

Scene lifecycle signals: teardown gets full destroy semantics, and `onPause`/`onResume` fire on every effective pause transition.

- Scene teardown (`pop`, `replace`, engine shutdown) now marks every entity destroyed before any component `onDestroy` runs, and emits `entity:destroyed` once per entity — including entities queued with `destroy()` but not yet flushed. Cached references and lifetime-tracking listeners see the same contract on both destroy paths.
- After destruction — end-of-frame flush or scene teardown — `entity.scene` throws and `entity.tryScene` returns `null`. Component `onDestroy` hooks still see the scene; the entity detaches after component teardown.
- `Scene.paused` is now an accessor: assigning it fires `onPause`/`onResume` when the effective pause state (`isPaused`) flips. Manual pauses, `autoPauseOnBlur`, and snapshot restore of a paused scene all reach the hooks; writes that don't change the effective state (repeated assignments, flips masked by a stack pause, pre-push writes) fire nothing. To start a scene paused, set `paused = true` before pushing it; writing `paused` from inside a lifecycle hook races the transition's pause diff and logs a dev-mode warning.
