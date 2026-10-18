---
"@yagejs/core": minor
---

Follow one host state for application activity, visibility and focus.

- `Host` reports `lifecycle` — `activity`, `visibility` and `focus`, each of which may be `"unknown"` — and derives `active` from them. `activeWhenUnfocused` (default `false`) decides whether an unfocused window counts as active. A page with no host adapter reports its own visibility and the focus of its window.
- `host:active` and `host:lifecycle` carry the state to game code. Scene `onPause` and `onResume` run before both.
- A host adapter feeds the same state through two optional members of `HostProvider`: `lifecycle`, read once at attach, and `watchLifecycle(report)`, which the adapter calls on every later change. Values arriving from a host are validated where they enter `Host`.
- `Breaking:` `SceneManager.autoPauseOnBlur` is `SceneManager.autoPause`, and it holds the stack paused while `Host.active` is `false`, which includes an unfocused window.
- The host pause belongs to `SceneManager`, so `Scene.paused` holds only what the game wrote: a manual pause made while the game is in the background is still in force after the return, and a scene pushed while the host is inactive enters paused.
- `Inspector.getHost()` reports the host's identity, its three fields, `active` and `activeWhenUnfocused`. `snapshot()` leaves the host out.
- `TestHostPlugin` takes a lifecycle argument and reports changes through `setLifecycle`.
- The loop's own animation-frame driver reports at most 100 ms a frame, the bound a PixiJS ticker applies by default.
