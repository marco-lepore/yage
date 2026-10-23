---
"@yagejs/debug": patch
---

The `debug` Inspector extension reports how a scene is drawn: `getSceneRender(sceneName)` returns the `alpha`, `visible` flag and `x` / `y` offset of the scene's whole render tree, or `undefined` for a scene with no render tree.
