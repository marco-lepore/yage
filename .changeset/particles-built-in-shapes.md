---
"@yagejs/particles": minor
---

Particles work without any texture asset. A new `shape` option on `EmitterConfig` picks one of six built-in white shapes, and `texture`/`textureKey` are no longer required.

- `new ParticleEmitterComponent({ lifetime: 1 })` renders 1×1 white particles. Set `tint` to color them and `scale` to size them.
- `shape?: ParticleShape | ShapeConfig` — `"pixel" | "circle" | "softCircle" | "diamond" | "softDiamond" | "line"`. The `soft*` variants fade from an opaque centre to a transparent edge, with `softDiamond` reading as a four-point sparkle.
- `ShapeConfig` gives the shape an explicit texture size: `{ type: "softCircle", size: 16 }` for a square, `{ type: "circle", size: [32, 16] }` for an ellipse, `{ type: "line", size: [4, 32] }` for a vertical streak. Default size is 64×64, `"line"` 64×8, `"pixel"` 1×1. No shape forces an aspect ratio. `size` is the generated texture's size in pixels, which at the default `scale: 1` is also the on-screen size — use a few fixed values and vary per-particle size with `scale`. A size must be a finite number above 0; anything else throws instead of producing an empty texture.
- `texture`, `textureKey` and `shape` are mutually exclusive: setting more than one is a type error. Passing several from plain JavaScript still resolves in that order.
- `shapeTexture(shape)` is exported for direct use. Each type and size pair is generated on first request and shared by every emitter asking for it — do not destroy the texture it returns. A 1×1 `"pixel"` is `Texture.WHITE` and generates nothing.
- Every shape is visible at every size, down to 1×1. `"pixel"` and `"line"` fill their texture edge to edge. The other four draw their outline inside the texture with a one-pixel antialiased edge, and fill their texture instead once they are too thin to hold one — at 3 pixels or less on either axis, that border would be the whole shape.
- Shape generation writes an RGBA buffer, so it runs in headless tests and needs no DOM, canvas, or renderer.
- A snapshot carries the emitter's asset key or its `shape: { type, size }`, never both, so shape emitters save and restore like texture ones. The key comes from whichever source actually rendered: an emitter built from a raw `Texture` object serializes as `null` with a warning even if a `textureKey` was passed alongside it.

Every `ParticlePresets` factory now takes its texture as an *optional* argument and falls back to a built-in shape, so `ParticlePresets.fire()` is a complete effect with no art.

- `fire(textureOrKey?)`, `smoke(textureOrKey?)`, `sparks(textureOrKey?)`, `rain(textureOrKey?)`. Existing call sites that pass a texture are unaffected.
- Default shapes: `fire` a 32px `softCircle`, `smoke` a 40px one, `sparks` a 10×3 `line`, `rain` a 2×20 `line`.
- Each preset's absolute particle size moved into that shape's `size`, leaving its `scale` as lifetime animation and per-particle variation centred on 1. A caller-supplied texture is therefore animated at its natural size instead of scaled against an assumed one. Preset emission rates, speeds and lifetimes were retuned to match.
- Because a preset config already carries a texture source and the three sources are mutually exclusive, overriding the source by spreading (`{ ...ParticlePresets.fire(), texture: myTex }`) is a type error. Pass it as the argument instead. Spreading to override anything else still works.
