---
"@yagejs/input": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `InputManager` exposes synthetic input drivers consumed by the inspector — `fireKeyDown`/`fireKeyUp`, `firePointerMove`/`firePointerDown`/`firePointerUp`, `fireGamepadButton`/`fireGamepadAxis`, `fireAction`, `clearAll` — plus `snapshotState()` returning a stable view of pressed keys, active actions, mouse and gamepad state.
- Synthetic actions are tracked separately (`syntheticPressedActions` / `syntheticActionStarts`) so `isPressed` / `isJustPressed` / `getHoldDuration` see fired actions even without a bound key. Mouse buttons and gamepad button/axis state are now tracked too, so `snapshotState()` is complete.
- `InputPlugin` routes real DOM pointer events through the new `firePointerDown`/`Up` paths so production input goes through the same code path as inspector-driven input.
- New `@yagejs/input/api` subpath that re-exports `InputManagerKey` and `InputConfig` for downstream packages that need the types without pulling the runtime.
