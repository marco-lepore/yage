# @yagejs/lighting

Radial 2D lights, light-level queries, and interchangeable lighting renderers
for [YAGE](https://yage.dev).

```ts
import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  LightSource,
  LightingPlugin,
  LightingWorldKey,
} from "@yagejs/lighting";
import { RendererPlugin } from "@yagejs/renderer";

const engine = new Engine();
engine.use(new RendererPlugin());
engine.use(
  new LightingPlugin({
    ambient: { level: 0.2, color: 0xb0b8cc },
  }),
);

class Cave extends Scene {
  readonly name = "cave";

  onEnter(): void {
    const torch = this.spawn("torch");
    torch.add(new Transform({ position: new Vec2(320, 180) }));
    torch.add(
      new LightSource({
        radius: 180,
        intensity: 0.9,
        color: 0xffb060,
      }),
    );
  }
}
```

Two renderers ship with the package. `overlayLighting()`, the default, draws
coloured light over an ambient floor with one hard edge per shadow.
`shaderLighting()` draws the same lights with shadow borders that widen with
the distance from the blocker and with a spotlight edge that fades. A scene
picks one by name.

Use the scene-scoped `LightingWorldKey` for gameplay queries:

```ts
class LightSensor extends Component {
  private readonly lighting = this.service(LightingWorldKey);

  levelAt(x: number, y: number): number {
    return this.lighting.levelAt(x, y);
  }
}
```

`levelAt()` adds the ambient level and every light contribution, then clamps
the result to `0..1`. A `LightOccluder` blocks light in the query and in the
built-in renderer alike, so a wall casts a shadow in the picture and in the
answer. Occluder data is renderer-neutral and available to custom renderers.

See [yage.dev/guides/lighting](https://yage.dev/guides/lighting) for setup,
configuration, and custom renderer details.
