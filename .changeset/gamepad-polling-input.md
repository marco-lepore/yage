---
"@yagejs/input": minor
---

Real gamepad polling, analog sticks/triggers, and `listenForNextKey` support across devices.

- `InputPollSystem` now polls `navigator.getGamepads()` each frame and routes button edges through the same internal path as keyboard/mouse, so `isPressed`, `isJustPressed`, hold-duration, and `listenForNextKey` all work uniformly across devices.
- New gamepad codes for the action map under W3C standard mapping: `GamepadA/B/X/Y`, `GamepadLB/RB/LT/RT`, `GamepadSelect/Start`, `GamepadLeftStick/RightStick`, `GamepadDPadUp/Down/Left/Right`, `GamepadHome`. Non-standard mappings expose `GamepadButton{0..15}`.
- New analog API: `getStick("left" | "right"): Vec2` (radial deadzone, magnitude clamped to 1.0) and `getTrigger("left" | "right"): number` (0..1).
- Connect/disconnect events: `onGamepadConnected(fn)` and `onGamepadDisconnected(fn)` return disposers; `onGamepadConnected` replays currently-known pads on subscribe. `gamepads()` synchronously polls `navigator.getGamepads()` for ground truth (events don't fire until first button press per browser security).
- New `InputConfig` options: `deadzones: { stick?, trigger? }`, `triggerThreshold`, `pollGamepads`. Trigger buttons (`GamepadLT`/`GamepadRT`) fire as button edges when their analog value crosses `triggerThreshold` (default 0.5).
- Page-visibility safety: tab going hidden force-releases held gamepad codes so they don't appear stuck on return.
- Synthetic API rework (breaking, pre-1.0): `fireGamepadButton(code, pressed)` now takes a code string (e.g. `"GamepadA"`) and routes through the real path so action queries see it. `fireGamepadAxis(side, value)` now takes a named axis (`"leftX"`, `"leftY"`, `"rightX"`, `"rightY"`, `"leftTrigger"`, `"rightTrigger"`). Pair `pollGamepads: false` with `DebugPlugin`'s `deterministicSeed` for reproducible inspector probes.
