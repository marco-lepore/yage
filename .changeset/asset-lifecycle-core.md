---
"@yagejs/core": minor
---

A scene's preloaded assets have one owner, so the documented per-level unload frees them.

- New `SceneManager.preload(scene, onProgress?)` loads a scene's manifest ahead
  of time and marks the scene; the next `push`/`replace` of it consumes the
  mark instead of loading again. Use it to pay for a level's assets while the
  player is still on the menu.
- `LoadingScene` loads its target through that method. It called
  `assets.loadAll` itself and the following `replace` acquired the same handles
  a second time, so every preloaded asset carried two references and never
  reached zero: a game unloading one reference per manifest entry in `onExit`
  freed nothing.
- `AssetManager.loadAll` takes its references in one pass, after every load in
  the call has resolved. A call that rejects now takes none, so its
  already-loaded siblings stay cached and uncounted and a retry counts each of
  them exactly once. Previously the cached ones were counted during the
  pre-scan, so any retry of a partially failed manifest left references nothing
  released.
- A second declaration of one path under one handle type with different loader
  options warns in development and names both declarations. The cache is keyed
  by type and path, so the second declaration's options were dropped in
  silence — `webFont(p, { family })` followed by `webFont(p, { family, bitmap })`
  loaded once with no atlas baked and no warning. The first load still wins.
- Attribution: a throw from `Scene.onProgress`, from a `LoadingScene` target
  factory, or from an `onLoadError` hook is recorded against its source and
  readable through `Inspector.getErrors().callbackErrors`. Propagation is
  unchanged.
