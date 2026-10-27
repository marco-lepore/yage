---
"@yagejs/audio": minor
---

Schedule sounds and music on the audio clock, and render audio offline through the same graph.

- **Breaking:** playback uses native Web Audio, without `@pixi/sound`. A loaded sound asset holds an `AudioBuffer`, and constructing an `AudioManager` directly takes a `BaseAudioContext`.
- **Breaking:** fades run on the audio clock. `ProcessSystem.timeScale` does not scale them, and scene pause and scene time scale leave them running as before. `fadeTo` returns `void`: cancel a fade with a new volume write or `stop()`. A volume write that replaces a `stopOnComplete` fade also cancels its stop. Replace the `easing` option of `fadeTo` with `curve: "linear" | "exponential"`. `crossfade` takes no `easing` option and fades linearly. Pausing a handle or its channel holds its position and its remaining fade.
- Add start times (`at`), sample offsets, scheduled stops (`stopAt`), stereo `pan`, loop regions, and `setVolume`, `setSpeed`, `setPan` and `setChannelVolume` automation with linear or exponential ramps. `SoundHandle.release({ at, duration })` fades a sound out and stops it.
- Add child channels (`createChannel(name, { parent })`, `removeChannel`), `onChannelPause`, `addScheduler` and `AudioTimeline` for sequencers that book sounds ahead of playback.
- `AudioPlugin` resumes the context on the first gesture, holds it while `Host` reports the game inactive (with `autoPause` on), and runs the scheduler timer. `getDiagnostics()` and the Inspector `audio` extension report context state, voices, late starts, channels and callback failures.
- `renderAudio` renders a booked plan through the same voices and channels in an `OfflineAudioContext`. `measureAudio` reports sample peak, RMS, clipped samples and non-finite samples.
- `sound(path, metadata)` and `registerSound(alias, buffer, metadata)` take a `SoundMetadata`: the sustain loop that `loop: true` plays and `rootNote`, the MIDI pitch of the recording. `AudioManager.getSoundMetadata(ref)` reads it back.
- Engines in one page share a decoded sound file. Each engine's load holds it, and the file is released when the last engine that loaded it unloads it or is destroyed. Another engine loading the same file with different metadata throws an error that names the file.
