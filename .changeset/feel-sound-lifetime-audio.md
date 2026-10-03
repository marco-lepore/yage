---
"@yagejs/audio": minor
---

Control sound lifetimes and stopping fades.

- Add `SoundRequestHandle.release({ fadeOut })` for fading the final owner's shared recording to silence. Other requests and `playOnce` owners keep their recording playing.
- Keep the final request active through its fade. New requests during that fade start a fresh recording, and released requests receive no completion callback.
- Complete paused sounds when stopped, including release fades, so shared requests finish and the audio backend releases its playback instance.
