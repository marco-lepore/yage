---
"@yagejs/audio": patch
---

Import `@yagejs/audio` outside a browser. `AudioPlugin` loads `@pixi/sound` when it installs, so nothing in the package reaches `document` while it is being imported — a level check or a test run in Node can import a module that uses `sound()` or `SoundComponent`.

`registerSound` and `unregisterSound` keep their signatures. A registration made before the plugin installs is applied when it does, so a call at module scope still works.
