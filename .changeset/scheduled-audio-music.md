---
"@yagejs-addons/music": minor
---

Play adaptive music on the audio clock.

- New package. `MusicComponent` plays a repeating `MusicSong` for its entity: tracks of notes over recorded or generated samples, any meter, swing, seeded timing variation and per-track gain and pan. Notes transpose against the root note registered with each sound, so synth instruments need no tuning in the song.
- Named parameters fade layers in and out, `transition` changes song on the next bar or grid line with a crossfade, and `cue` books a sound on the next grid line, moved to the nearest chord tone when `followHarmony` is set.
- Music runs on the audio clock, so scene pause and time scale leave it playing. `pause()` and a paused parent channel hold the beat, and a song requested while paused starts after resume. Disabling or destroying the component stops its notes.
- `play` books the opening notes immediately, so a slow first frame does not skip them.
- `MusicPlayer` exposes position (including beats per bar), harmony and diagnostics, and plays inside `renderAudio` for reproducible offline mixes and for rendering a song once into a buffer that loops without a player.
