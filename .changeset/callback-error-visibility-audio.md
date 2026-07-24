---
"@yagejs/audio": patch
---

An `AudioManager.onUnlock` callback that throws is now reported instead of being discarded silently.

The callback is one-shot, so there's nothing to unsubscribe. It's logged with a full stack trace naming it and rethrown — see the `@yagejs/core` changeset — and recorded, readable via `engine.inspector.getErrors().callbackErrors`.
