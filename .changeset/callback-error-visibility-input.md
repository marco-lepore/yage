---
"@yagejs/input": patch
---

A key, action, or gamepad listener that throws is now attributed to the listener itself instead of silently disabling input polling for the rest of the session.

Previously the throw propagated up through `InputPollSystem`'s update call, which permanently disabled the system and stopped all keyboard/action/gamepad edges from firing, with no console output. Now `InputManager` catches the throw at the listener itself — key/action listeners, gamepad connect/disconnect listeners, and active-pad-change listeners — reports it with a full stack trace naming the listener, and rethrows: see the `@yagejs/core` changeset. The failure is recorded and readable via `engine.inspector.getErrors().callbackErrors`.
