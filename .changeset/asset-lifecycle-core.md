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
- A second request for an asset already loading joins that load instead of
  starting its own. A rejected `loadAll` leaves its slower siblings loading, so
  the retry that follows started a second load for one of them: two completions
  writing one cache slot, and the asset that lost never reaching `unload`.
- `clear()` empties its bookkeeping before running any loader, so an asset held
  by another asset's loader — a Tiled map's tileset images — is freed once. The
  map's `unload` releases its images from inside the same pass that had already
  freed them, which unloaded each image twice.
- Attribution: a throw from `Scene.onProgress`, from a `LoadingScene` target
  factory, or from an `onLoadError` hook is recorded against its source and
  readable through `Inspector.getErrors().callbackErrors`. Propagation is
  unchanged.
