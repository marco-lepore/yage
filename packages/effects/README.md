# @yagejs/effects

Built-in visual-effect presets for [YAGE](https://yage.dev) — wraps
[`pixi-filters`](https://pixijs.io/filters/) and the built-in
`ColorMatrixFilter` behind the engine's handle-based `.fx.addEffect` API.

```ts yage-context="component"
import { hitFlash, bloom, crt } from "@yagejs/effects";
import { SpriteComponent, SceneRenderTreeKey } from "@yagejs/renderer";

// Component scope — flashes when the entity takes damage.
const sprite = this.entity.get(SpriteComponent);
const flash = sprite.fx.addEffect(hitFlash({ color: 0xffffff, duration: 0.1 }));
flash.trigger();

// Layer scope — bloom on the gameplay layer only.
const tree = this.use(SceneRenderTreeKey);
tree.get("world").fx.addEffect(bloom({ threshold: 0.8, bloomScale: 1.4 }));

// Scene scope — CRT scanlines for the whole scene.
tree.fx.addEffect(crt({ lineWidth: 1, lineContrast: 0.25 }));
```

Every preset uses `defineEffect` from `@yagejs/renderer` and works with the
same handle API as a custom effect.

See [yage.dev/guides/rendering/effects](https://yage.dev/guides/rendering/effects)
for the full list and option reference.
