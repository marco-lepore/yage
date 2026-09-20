---
"@yagejs/audio": minor
---

Add mixer-aware fades and crossfades.

- Treat `SoundHandle.volume` as the per-sound volume before the channel multiplier, so channel changes preserve handle adjustments and active fades.
- Add `SoundHandle.fadeTo()` with duration, easing and optional stop-on-completion behavior.
- Add `AudioManager.crossfade()` to fade between two sounds and return the incoming handle.
