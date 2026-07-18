---
"@yagejs/renderer": minor
---

Explicit programmatic-texture path: runtime-created textures now register under asset keys.

- New `registerTexture(key, texture)` / `unregisterTexture(key)`: put a runtime-created texture (e.g. from `RendererPlugin.createTexture`) into the global asset cache under a key, so every key-based surface resolves it like a preloaded asset — `SpriteComponent`'s `texture`, `FrameSource.sheet` strips, and particles' `textureKey`. Registering over a loaded asset's key throws; unregistering never destroys the texture (the creator owns it).
- New `TextureRef` type (`string | TextureHandle`) — the serializable texture reference serialized components accept.
- Breaking: `SpriteComponentOptions.texture` and `setTexture()` narrow from `TextureInput` to `TextureRef` — raw `Texture` objects are no longer accepted. `serialize()` always returns full `SpriteData` (the null-with-console.warn path is gone) and `SpriteData.textureKey` is non-null. Reference runtime textures by registered key instead.
- Breaking: resolving a texture key that is neither preloaded nor registered now throws an error naming the key (`resolveTextureInput`, `sliceSheet`, and every component built on them) instead of producing an empty texture or an obscure downstream `TypeError`.
