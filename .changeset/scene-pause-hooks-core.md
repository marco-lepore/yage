---
"@yagejs/core": patch
---

Fire scene `onPause` and `onResume` once for each change of `isPaused`.

- `SceneManager` compares every change of a scene's effective pause against the state that scene's hooks last reported, whatever caused the change. Switching `scenes.autoPause` on inside `onEnter` while the host is inactive fires one `onPause` per scene, and one `onResume` at the return.
- A `scene.paused` write from inside a lifecycle hook fires one hook and logs no warning. A scene that is not on the stack, such as one running its `onExit`, fires neither hook.
- A throwing `onPause` leaves the scenes after it with neither hook, so the return fires no `onResume` on them. The scene whose `onPause` threw counts as paused, and the return fires its `onResume`.
