---
"@yagejs/core": patch
---

Run YAGE games in Electron with a host adapter and a locked-down shell.

- The `screen:fullscreen` event's description in `EngineEvents` names the host's window as a source beside the canvas host element, for a game whose host adapter supplies fullscreen.
