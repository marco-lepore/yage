---
"@yagejs/input": patch
---

A buffered-press window can count on a scene's simulation time as well as on the raw input clock.

- `InputManager.consumeBufferedPress(action, windowSeconds, { clock })` measures the window on the given clock. `SceneTime` satisfies the new `InputClock` shape, so pass the one resolved from `SceneTimeKey`: `input.consumeBufferedPress("jump", 0.12, { clock: this.use(SceneTimeKey) })`. Omitting the option keeps the raw input clock, which ignores scene pause and time scale.
- The input plugin registers the `SceneTime` of every scene the engine enters, so a jump buffer measured on it holds through a pause menu and follows the scene's effective time scale with no game-side countdown.
