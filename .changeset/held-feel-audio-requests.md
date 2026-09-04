---
"@yagejs/audio": minor
---

Let independent callers share and release one-shot audio safely.

- Add `AudioManager.requestOnce()` and `SoundRequestHandle` for one releasable
  request on playback shared by alias and channel.
- Keep `playOnce()` idempotent while request callbacks and force-stop cleanup
  follow the shared playback lifetime.
