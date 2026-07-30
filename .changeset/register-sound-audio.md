---
"@yagejs/audio": minor
---

`registerSound(alias, buffer)` and `unregisterSound(alias)` register a runtime-generated `AudioBuffer` under an alias, so it plays through the existing `AudioManager` channels, mute, and blur auto-pause exactly like a preloaded sound. This is the audio counterpart to `@yagejs/renderer`'s `registerTexture`, and lets code that synthesizes audio at runtime (procedural sound effects, generated jingles) register its output without going through a file asset.
