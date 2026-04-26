# @yagejs/effects

Built-in visual-effect presets for [YAGE](https://yage.dev) — wraps
[`pixi-filters`](https://pixijs.io/filters/) and the built-in
`ColorMatrixFilter` behind the engine's handle-based `addEffect` API.

```ts
import { hitFlash, bloom, crt } from "@yagejs/effects";

// Component scope — flashes when the entity takes damage.
const flash = sprite.addEffect(hitFlash({ color: 0xffffff, duration: 100 }));
flash.trigger();

// Layer scope — bloom on the gameplay layer only.
const tree = this.use(SceneRenderTreeKey);
tree.get("world").addEffect(bloom({ threshold: 0.8, bloomScale: 1.4 }));

// Scene scope — CRT scanlines for the whole scene.
tree.addEffect(crt({ scanlines: true }));
```

Every preset is registered through `defineEffect` (see
`@yagejs/renderer`), so attached effects survive `SaveService` snapshot
round-trips: their `name` + `options` are recorded, and on load the
preset's factory is re-invoked to rebuild the filter.

See [yage.dev/guides/rendering/effects](https://yage.dev/guides/rendering/effects)
for the full list and option reference.
