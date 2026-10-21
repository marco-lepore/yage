---
"@yagejs-addons/music": minor
---

Add scheduled playback, procedural instruments, and adaptive music through one audio path.

- Introduce MusicComponent and MusicPlayer with plain song, track, note and harmony data. Support arbitrary meter, subdivision swing, song gain, seeded timing variation, named parameter layers, quantized transitions and harmony-following cues.
- Use recorded or generated samples through AudioManager. Music follows audio time independently of scene pause and time scale; component disable/destroy cancels its playback. Explicit pause holds the beat and resumes with the next note.
- Expose transport diagnostics and support deterministic plans through the audio package's offline renderer.
