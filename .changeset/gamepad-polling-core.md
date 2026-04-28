---
"@yagejs/core": minor
---

Real gamepad polling, analog sticks/triggers, and `listenForNextKey` support across devices.

- `Inspector.input.gamepadButton(code, pressed)` and `gamepadAxis(side, value)` now take string identifiers (gamepad code / `GamepadAxisKey`) instead of numeric indices, matching the new `@yagejs/input` API and avoiding the W3C-mapping leak into the public Inspector surface.
- `InputStateSnapshot.gamepad` updated: `buttons` is now `string[]` (gamepad codes) and `axes` is now `Array<{ key: string; value: number }>` (key format `${padIndex}:${axisName}`), matching what the new `InputManager.snapshotState()` returns.
