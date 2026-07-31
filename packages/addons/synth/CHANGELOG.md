# @yagejs-addons/synth

## 0.1.0

### Minor Changes

- [#224](https://github.com/marco-lepore/yage/pull/224) [`290c989`](https://github.com/marco-lepore/yage/commit/290c98964233223be4ea238a99c6160a56dc67b6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - New addon: `@yagejs-addons/synth` — procedural sound effects with no audio files.

  A sound is a plain parameter object (oscillator, pitch glide, noise mix, filter, attack + exponential release). `renderPatch` turns it into samples with plain math — no WebAudio, no unseeded randomness — so a sound is unit-testable, and `SynthPlugin` renders every entry in its config into an `AudioBuffer` and registers it with `@yagejs/audio`, giving it the engine's channels, volumes, mute, and blur auto-pause.

  Includes presets for the usual game cues (shoot, hit, explosion, hurt, pickup, coin, jump, land, dash, powerup, footstep, ui-click, ui-blip, alarm, victory, defeat, room tone), layered voices, note-sequence jingles, per-play pitch variation through `variants` + `playRandom`, and seamless ambient loops. Requires `@yagejs/core` and `@yagejs/audio` as peers.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`bfe6878`](https://github.com/marco-lepore/yage/commit/bfe687825124e8dce5f382b992021e08f6fc759f)]:
  - @yagejs/audio@0.10.0
  - @yagejs/core@0.10.0
