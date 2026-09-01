---
"@yagejs/audio": minor
---

Remove automatic `SoundComponent` snapshot support and its serialized data
type. Reconstruct playback from game-owned save state and registered asset
aliases.

Add `SoundComponent.alias` / `.channel` / `.loop` / `.volume` for reading the
component's playback config back — also what the Inspector now reports for it.
