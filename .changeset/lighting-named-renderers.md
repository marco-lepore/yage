---
"@yagejs/lighting": minor
---

Configure lighting renderers under names, let a scene pick one, and add bounced light.

**Breaking:** `LightingConfig.renderer` is replaced by `renderers`, a map from a name to a renderer factory, plus `defaultRenderer`. `renderer: overlayLighting(opts)` becomes `renderers: { overlay: overlayLighting(opts) }` with `defaultRenderer: "overlay"`, and `renderer: null` becomes a `null` entry, such as `renderers: { none: null }` with `defaultRenderer: "none"`. Leave `renderers` out for `{ overlay: overlayLighting() }` under the default name `"overlay"`. Set `renderers` and `defaultRenderer` is required, naming one of the entries: the plugin throws at install when it is missing or names something else, listing the configured names.

`LightingRendererContext` carries a required `bounce` field, so anything that builds that context by hand — a custom renderer's own tests — has to pass it. `LightingWorldManager`'s constructor takes an options object rather than positional ambient and factory arguments.

A scene chooses its renderer and its bounced light through a `lighting` property this package adds to core's `Scene`:

```ts
class CaveScene extends Scene {
  readonly name = "cave";
  readonly lighting = {
    renderer: "overlay",
    bounce: { strength: 0.8, radius: 90 },
  };
}

engine.use(
  new LightingPlugin({
    renderers: { overlay: overlayLighting(), none: null },
    defaultRenderer: "overlay",
    bounce: { strength: 0.4, radius: 40 },
  }),
);
```

The property is read once, when the scene is entered and its lighting world is created, so a live scene keeps what it entered with. An unknown renderer name throws there naming the scene and the configured renderers, and so does a bounce setting outside its range. A `null` renderer entry keeps `levelAt()` and draws nothing.

Bounced light combines the finished light buffer with a blurred, low-resolution copy of itself, so light creeps past shadow edges and around corners. `blend` picks how: `"max"`, the default, keeps the brighter of the two, so lit areas and shadow borders stay as drawn and only the dark is lifted; `"mix"` blends the whole picture toward the blurred copy, which keeps the scene's overall brightness and softens every shadow edge. `strength` runs from 0 to 1 and says how strongly the copy shows, and `radius` is how far the blur reaches in screen pixels, independent of the renderer's `resolutionScale`. A scene that leaves `bounce` out takes `LightingConfig.bounce`, which the plugin checks at install; `bounce: null` on the scene leaves that scene without any; bounce is off when neither sets one. The pass costs one more offscreen buffer per scene and runs only on frames where the light buffer was redrawn. It is a visual treatment — `levelAt()` never sees it, so raise `ambient.level` when gameplay should agree that a shadow is not pitch black.

`LightingComposite` is the step that owns a scene's light buffer, multiplies it over the scene and applies `bounce`. The built-in overlay finishes with it, and a custom renderer that draws its light into a container can reuse it; the scene's resolved bounce reaches a renderer through `bounce` on its factory context.
