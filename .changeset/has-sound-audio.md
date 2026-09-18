---
"@yagejs/audio": patch
---

Ask whether a sound is registered with `audio.hasSound(ref)`.

It takes an alias or a `sound()` handle and returns a boolean. The check is the one `play`, `playOnce`, `requestOnce` and `playRandom` make before they throw, so a game that builds an alias at runtime — one variant per surface, per weapon, per language — can choose a fallback rather than risk the throw.

The predicate answers registration alone. Whether audio can be heard is a separate question: `isUnlocked()` reports the browser's autoplay gate, and `muteChannel` / `muteAll` own mute.
