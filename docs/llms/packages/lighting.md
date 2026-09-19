# @yagejs/lighting

Depends on `@yagejs/core`, `@yagejs/renderer`. Radial lights, continuous
light-level queries, and per-scene renderer backends.

## Setup

```ts
import { LightingPlugin } from "@yagejs/lighting";
import { RendererPlugin } from "@yagejs/renderer";

engine.use(new RendererPlugin());
engine.use(
  new LightingPlugin({
    ambient: {
      level: 0.2, // 0..1; default 0.15
      color: 0xb0b8cc, // default 0xffffff
    },
  }),
);
```

The default `OverlayLightingRenderer` draws a half-resolution light buffer on
a screen-space `"lighting"` layer at order `900`. It multiplies ambient colour
and soft radial lights over the scene. A light is drawn only where no occluder
stands between it and the surface, so the picture follows the same rule as
`levelAt()`. Shadow edges are hard. Coloured lights tint the surfaces they
reach. UI on the conventional order `1000` remains above the lighting layer.

Configure the built-in renderer:

```ts
import { LightingPlugin, overlayLighting } from "@yagejs/lighting";

engine.use(
  new LightingPlugin({
    renderer: overlayLighting({
      layer: "lighting",
      order: 900,
      resolutionScale: 0.5,
      antialias: true,
    }),
  }),
);
```

Pass `renderer: null` to keep `levelAt()` and disable visual output. The
`RendererPlugin` dependency is still required.

## LightSource

Add `LightSource` to an entity with a `Transform`:

```ts
import { Transform, Vec2 } from "@yagejs/core";
import { LightSource } from "@yagejs/lighting";

const torch = scene.spawn("torch");
torch.add(new Transform({ position: new Vec2(320, 180) }));
const light = torch.add(
  new LightSource({
    radius: 180, // required; world pixels, above 0
    intensity: 0.9, // 0..1; default 1
    color: 0xffb060, // default 0xffffff
    castShadows: true, // default true
    enabled: true, // default true
  }),
);
```

The centre follows `Transform.worldPosition`, including parent transforms.
Transform scale does not change `radius`. Set `light.radius`,
`light.intensity`, `light.color`, or `light.castShadows` to update a live
light. Disabling the component or its entity removes it until it becomes
active again.

With `castShadows: false` a light passes through every occluder, in the query
and in the drawn picture. Use it for a global fill or a highlight that has to
reach everywhere.

YAGE does not persist light components automatically. Store any durable light
settings in the game's explicit save root and rebuild the component with the
scene.

## Gameplay queries

`LightingWorldKey` is scene-scoped:

```ts
import { Component } from "@yagejs/core";
import { LightingWorldKey } from "@yagejs/lighting";

class LightSensor extends Component {
  private readonly lighting = this.service(LightingWorldKey);

  levelAt(x: number, y: number): number {
    return this.lighting.levelAt(x, y); // 0..1
  }
}
```

Call `this.lighting.setAmbient(0.08)` or
`this.lighting.setAmbient(0.2, 0x8090b8)` to change the ambient light.

`levelAt(x, y)` starts with `ambientLevel`, adds each enabled radial source
that reaches the point using linear falloff, and clamps the result to `1`.
Source colours do not change the scalar query.

A source reaches the point only when the straight line from the light to the
point misses every enabled occluder. Touching an edge or a corner counts as
blocked, so two occluders that meet leave no gap. An occluder that contains
the light does not block it, so a lamp mounted on a pillar still lights the
room. A point inside an occluder is dark for every light outside it. Shadows
are hard: partial cover does not dim a light.

Sample a whole grid in one call with `levelGridInto`:

```ts
import type { LightGrid } from "@yagejs/lighting";

const grid: LightGrid = {
  x: 0, // world x of the region's left edge
  y: 0, // world y of the region's top edge
  cols: 40,
  rows: 20,
  cellWidth: 16,
  cellHeight: 16,
};
const levels = new Float32Array(grid.cols * grid.rows);

lighting.levelGridInto(levels, grid); // returns the same buffer
levels[row * grid.cols + col]; // 0..1 at that cell's centre
```

The buffer is row-major and the caller owns it, so a field rebuilt every frame
allocates nothing. Each cell holds what `levelAt` returns for that cell's
centre. Each source is summed over the cells its radius reaches, against the
occluders within that radius, so the cost grows with the lit area rather than
with the whole grid.

`levelGridInto` throws a `RangeError` when `out.length` is not `cols * rows`,
when `cols` or `rows` is not a positive integer, when a cell size is not
positive and finite, or when `x` or `y` is not finite.

`LightingWorld` also exposes:

```ts
lighting.sources; // ReadonlySet<LightSource>
lighting.occluders; // ReadonlySet<LightOccluder>
lighting.ambientLevel;
lighting.ambientColor;
```

## LightOccluder

Occluders are renderer-neutral data centred on an entity's `Transform`:

```ts
import { LightOccluder } from "@yagejs/lighting";

wall.add(
  new LightOccluder({
    shape: { type: "box", width: 96, height: 24 },
  }),
);

pillar.add(
  new LightOccluder({
    shape: { type: "circle", radius: 20 },
  }),
);

rock.add(
  new LightOccluder({
    shape: {
      type: "polygon",
      vertices: [
        { x: -20, y: 12 },
        { x: 0, y: -18 },
        { x: 24, y: 10 },
      ],
    },
  }),
);
```

Shapes use local pixels. Position, rotation and scale come from the entity's
world transform. A uniform positive scale resizes the shape; any other scale
turns it into a scaled outline, matching how a physics collider follows entity
scale. Store durable occluder settings in the game's explicit save root.

An enabled occluder is opaque to `levelAt()`, to `levelGridInto()`, and to the
built-in overlay renderer. Disabling the component or its entity lets light
through again. Custom renderers read `LightingWorld.occluders`.

Both `LightSource` and `LightOccluder` expose world coordinates as an immutable
`position: Vec2` and as `getPositionInto(out: Vec2Buffer): Vec2Buffer`.
For repeated reads, reuse a buffer from `@yagejs/core`:

```ts
const position = new Vec2Buffer();
light.getPositionInto(position);
occluder.getPositionInto(position);
```

`getPositionInto` overwrites and returns the supplied buffer without
constructing a `Vec2`. The buffer holds world pixels, including parent
transforms, and stays unchanged until overwritten. Use `position` for an
immutable value you retain or share.

## Custom renderer

`LightingConfig.renderer` accepts a per-scene `LightingRendererFactory`:

```ts
import type {
  LightingRenderer,
  LightingRendererFactory,
} from "@yagejs/lighting";

const renderer: LightingRendererFactory = ({ scene, world, renderer }) => {
  const backend: LightingRenderer = {
    render(frame) {
      // Read world.sources and world.occluders.
      // frame.camera is the highest-priority enabled camera in this scene.
      // frame.width and frame.height are the virtual viewport size.
    },
    destroy() {
      // Release this scene's resources.
    },
  };
  return backend;
};

engine.use(new LightingPlugin({ renderer }));
```

YAGE creates one backend per entered scene. Renderer callbacks are attributed
through the engine error boundary and still rethrow.

A custom renderer that draws shadows should apply the rule `levelAt()` applies,
or the drawn light and the queried light disagree.
