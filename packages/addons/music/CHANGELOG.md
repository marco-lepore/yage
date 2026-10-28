# @yagejs-addons/music

## 0.1.0

### Minor Changes

- [#418](https://github.com/marco-lepore/yage/pull/418) [`4f91952`](https://github.com/marco-lepore/yage/commit/4f9195241f58ac412c0c35b2ba5a55bab03de2de) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Play adaptive music on the audio clock.
  - New package. `MusicComponent` plays a repeating `MusicSong` for its entity: tracks of notes over recorded or generated samples, any meter, swing, seeded timing variation and per-track gain and pan. Notes transpose against the root note registered with each sound, so synth instruments need no tuning in the song.
  - Named parameters fade layers in and out, `transition` changes song on the next bar or grid line with a crossfade, and `cue` books a sound on the next grid line, moved to the nearest chord tone when `followHarmony` is set.
  - Music runs on the audio clock, so scene pause and time scale leave it playing. `pause()` and a paused parent channel hold the beat, and a song requested while paused starts after resume. Disabling or destroying the component stops its notes.
  - `play` books the opening notes immediately, so a slow first frame does not skip them.
  - `MusicPlayer` exposes position (including beats per bar), harmony and diagnostics, and plays inside `renderAudio` for reproducible offline mixes and for rendering a song once into a buffer that loops without a player.

### Patch Changes

- Updated dependencies [[`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`4f91952`](https://github.com/marco-lepore/yage/commit/4f9195241f58ac412c0c35b2ba5a55bab03de2de), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/core@0.13.0
  - @yagejs/audio@0.13.0
