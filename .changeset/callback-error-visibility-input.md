---
"@yagejs/input": patch
---

A key, action, gamepad, pointer, or wheel listener that throws is now attributed to the listener itself instead of silently disabling input polling for the rest of the session.

Previously the throw propagated up through `InputPollSystem`'s update call, which permanently disabled the system and stopped all keyboard/action/gamepad edges from firing, with no console output. Now `InputManager` catches the throw at the listener itself — key/action listeners, gamepad connect/disconnect listeners, active-pad-change listeners, pointer listeners (down/up/move/cancel), and wheel listeners — reports it with a full stack trace naming the listener, and rethrows: see the `@yagejs/core` changeset. The failure is recorded and readable via `engine.inspector.getErrors().callbackErrors`.

Pointer and wheel listeners fire from DOM event handling, not from inside the game loop, so a throw there is attributed and reported the same way but does not stop the loop.
