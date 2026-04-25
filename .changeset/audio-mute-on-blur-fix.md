---
"@yagejs/audio": patch
---

Fix `autoMuteOnBlur` so it actually controls pause-on-blur behavior.

The flag was a no-op in practice: `@pixi/sound`'s `WebAudioContext.autoPause` (default `true`) was suspending the entire `AudioContext` on `window.blur` independently, and our own `IMediaContext.muted` toggle never broadcast a `refresh()` to live sound instances. Result: audio paused regardless of the flag, and turning the flag off didn't keep audio playing.

`AudioManager` now delegates pause-on-blur to pixi-sound's built-in `autoPause`, propagating the initial value at construction and writing through on the setter. When the flag is toggled while the window is currently unfocused, `paused` is reconciled immediately so the change takes effect now rather than waiting for the next blur event. The custom `visibilitychange` listener and snapshot/restore machinery are gone.
