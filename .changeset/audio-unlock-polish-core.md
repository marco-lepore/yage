---
"@yagejs/core": minor
---

Add `SceneManager.autoPauseOnBlur` — opt-in automatic scene pause on tab hide/show.

- New flag on `SceneManager` (default `false`). When enabled, pauses every scene in `activeScenes` on `document.hidden === true` and restores only those scenes on return — user-paused scenes (manual `scene.paused = true` or `pauseBelow` cascade) are never touched. Toggling the flag off mid-blur unpauses immediately.
- `SceneManager` attaches its own `visibilitychange` listener in `_setContext` and tears it down in `_destroy`. Guarded for non-browser environments.
