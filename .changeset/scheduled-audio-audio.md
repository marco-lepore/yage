---
"@yagejs/audio": minor
---

Add scheduled playback, procedural instruments, and adaptive music through one audio path.

- Replace Pixi audio playback with native Web Audio. **Breaking:** recorded assets now contain AudioBuffer, and direct AudioManager construction requires a BaseAudioContext. Add absolute starts, sample offsets, scheduled stops, sustain regions, stereo pan, hierarchical channels, and gain/rate/pan automation.
- **Breaking:** fades now use audio time and return void. Replace Process cancellation with a new volume write or stop; use linear or exponential curves instead of easing functions. Scene time scale no longer changes fades. Handle/channel pause retains position and remaining automation.
- Own browser unlock, visibility suspension, lookahead scheduling and cleanup in AudioPlugin. Preserve shared playback requests and expose timing, voice and callback diagnostics through the Inspector.
- Render authored operations through the same graph offline and measure sample peak, RMS, clipping and non-finite samples without an implicit compressor.

- Declare exported sound banks with `soundBank`, and retain sustain-loop metadata through ordinary scene asset loading, reference counting and unload.
