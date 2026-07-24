---
"@yagejs/audio": patch
---

An `AudioManager.onUnlock` callback that throws is now reported instead of being discarded silently.

The callback is one-shot, so there's nothing to unsubscribe. Under the engine's default `errors: "fatal"` policy, a throwing callback stops the game with a full stack trace naming it — see the `@yagejs/core` changeset. Under `errors: "isolate"`, it's logged and recorded, readable via `engine.inspector.getErrors().callbackErrors`.
