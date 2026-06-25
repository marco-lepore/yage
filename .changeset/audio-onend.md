---
"@yagejs/audio": minor
---

Add an `onEnd` callback to `AudioPlayOptions`. `audio.play(alias, { onEnd })` fires it once when the sound finishes on its own (its `end` event) — not on `stop()`, and never for a `loop`ing sound. The "tell me when this clip is done" seam, e.g. gating dialogue auto-advance on a voice clip without polling `SoundHandle.playing`.
