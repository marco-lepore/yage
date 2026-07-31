---
"@yagejs-addons/synth": minor
---

New addon: `@yagejs-addons/synth` — procedural sound effects with no audio files.

A sound is a plain parameter object (oscillator, pitch glide, noise mix, filter, attack + exponential release). `renderPatch` turns it into samples with plain math — no WebAudio, no unseeded randomness — so a sound is unit-testable, and `SynthPlugin` renders every entry in its config into an `AudioBuffer` and registers it with `@yagejs/audio`, giving it the engine's channels, volumes, mute, and blur auto-pause.

Includes presets for the usual game cues (shoot, hit, explosion, hurt, pickup, coin, jump, land, dash, powerup, footstep, ui-click, ui-blip, alarm, victory, defeat, room tone), layered voices, note-sequence jingles, per-play pitch variation through `variants` + `playRandom`, and seamless ambient loops. Requires `@yagejs/core` and `@yagejs/audio` as peers.
