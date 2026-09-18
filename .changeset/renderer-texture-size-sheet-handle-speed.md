---
"@yagejs/renderer": patch
---

Three additions: a size for `createTexture`, texture handles in a sheet frame source, and a `speed` option on `AnimatedSpriteComponent`.

`createTexture(draw, { width, height })` bakes exactly that region of the drawing, measured from `(0, 0)`. Without a size the texture is the drawn bounds, so its top-left corner is the first pixel drawn and a four-cell strip of circles bakes narrower than the cells it is sliced into. A non-finite or zero dimension throws naming the dimension.

```ts
const strip = renderer.createTexture(
  (g) => {
    for (let i = 0; i < 4; i++)
      g.circle(i * 32 + 16, 16, 6 + i * 2).fill(0xffcc00);
  },
  { width: 128, height: 32 },
);
```

`SheetFrameSource.sheet` takes a `TextureRef`: an asset key, or the handle `texture(path)` returns. That is the pair `SpriteComponent`'s `texture` accepts, so a preload declaration flows into a frame source without reaching for its `path`. A grid error names the handle's key. `AtlasFrameSource.atlas` stays a key, because an atlas resolves as a `Spritesheet` and not as a texture.

`AnimatedSpriteComponent` takes `speed` at construction, applied before the first `play()`, matching the `speed` accessor and `play({ speed })`. A non-finite value throws naming the component and the option.

The documentation for texture fills and runtime textures carries two facts that go with the size option: a baked texture's origin without a size, and the alpha a standalone `g.texture(...)` call draws at.
