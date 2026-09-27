---
"@yagejs/debug": patch
---

`DebugPlugin` installs the Inspector when the game has not installed one, and removes it on destroy. An Inspector the game installed with `InspectorPlugin` is reused and left in place.
