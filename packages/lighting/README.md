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

The built-in renderer draws coloured, soft-edged light over an ambient floor.
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
the result to `0..1`. The package also registers renderer-neutral
`LightOccluder` data for custom renderers. The built-in renderer does not cast
shadows.

See [yage.dev/guides/lighting](https://yage.dev/guides/lighting) for setup,
configuration, and custom renderer details.
