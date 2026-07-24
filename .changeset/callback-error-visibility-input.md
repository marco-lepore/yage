---
"@yagejs/input": patch
---

A key, action, or gamepad listener that throws is now attributed to the listener itself instead of silently disabling input polling for the rest of the session.

Previously the throw propagated up through `InputPollSystem`'s update call, which permanently disabled the system and stopped all keyboard/action/gamepad edges from firing, with no console output. Now `InputManager` catches the throw at the listener itself — key/action listeners, gamepad connect/disconnect listeners, and active-pad-change listeners. Under the engine's default `errors: "fatal"` policy, that means a throwing listener stops the game the same way any other developer-callback throw does, with a full stack trace naming the listener — see the `@yagejs/core` changeset. Under `errors: "isolate"`, the listener is logged, unsubscribed, and other listeners keep firing; the failure is recorded and readable via `engine.inspector.getErrors().callbackErrors`.
