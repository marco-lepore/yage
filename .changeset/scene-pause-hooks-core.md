---
"@yagejs/core": patch
---

Fire scene `onPause` and `onResume` once for each change of `isPaused`.

- A `scene.paused` write from inside a lifecycle hook, `onEnter` included, fires one hook and logs no warning.
- A `paused` write on a scene that is not on the stack, such as one running its `onExit`, fires neither hook.
- When an `onPause` throws, the scenes after it on the stack fire no `onPause` for that change, so the end of the pause fires no `onResume` on them either.
