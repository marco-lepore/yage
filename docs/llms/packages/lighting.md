# @yagejs/lighting

Depends on `@yagejs/core`, `@yagejs/renderer`. Radial lights, continuous
light-level queries, and per-scene renderer backends.

## Setup

```ts yage-context="engine"
import { LightingPlugin } from "@yagejs/lighting";
import { RendererPlugin } from "@yagejs/renderer";

engine.use(new RendererPlugin({ width: 800, height: 600 }));
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
stands between it and the surface. A light with a cone is drawn as a pie
slice. Coloured lights tint the surfaces they reach. UI on the conventional
order `1000` remains above the lighting layer.

The overlay draws hard shadow edges whatever a light's `size` says, and a hard
cone edge whatever its `softness` says. With neither set, the drawn picture is
exactly what `levelAt()` reports. With either set, the drawn edge runs along
the middle of the soft border the query answers with, so the two agree
everywhere except inside that border.

`shaderLighting()` draws those borders. See "Shader renderer" below.

## Renderers by name

`renderers` maps a name to a `LightingRendererFactory`, and a scene picks one
of those names. `defaultRenderer` draws every scene that names none.

The rule, checked at install:

- Leave `renderers` out and the plugin configures the built-in overlay under
  the name `"overlay"`, which is also the default.
- Set `renderers` and `defaultRenderer` is required, naming one of the entries.
  Leaving it out throws, and so does a name that is not among them.

```ts yage-context="engine"
import { LightingPlugin, overlayLighting } from "@yagejs/lighting";

engine.use(
  new LightingPlugin({
    renderers: {
      overlay: overlayLighting({
        layer: "lighting",
        order: 900,
        resolutionScale: 0.5,
        antialias: true,
      }),
      none: null,
    },
    defaultRenderer: "overlay",
  }),
);
```

```ts
import { Scene } from "@yagejs/core";

class CaveScene extends Scene {
  readonly name = "cave";
  readonly lighting = { renderer: "none" };
}
```

`Scene.lighting` is read once, when the scene is entered and its lighting world
is created, so a live scene cannot swap renderer. A name that is not configured
throws at that point, naming the scene and the configured names. A `null` entry
keeps `levelAt()` and draws nothing; the `RendererPlugin` dependency is still
required.

## Shader renderer

`shaderLighting(options)` is the second built-in renderer. It draws one quad
per light whose fragment shader runs the same projection `levelAt()` runs, so a
shadow's border widens with the distance from the blocker, a lamp wider than
its blocker lights around it, and a cone's `softness` fades its edge.

```ts yage-context="engine"
import { Scene } from "@yagejs/core";
import {
  LightingPlugin,
  overlayLighting,
  shaderLighting,
} from "@yagejs/lighting";

engine.use(
  new LightingPlugin({
    renderers: {
      soft: shaderLighting({
        layer: "lighting",
        order: 900,
        resolutionScale: 1,
      }),
      hard: overlayLighting(),
    },
    defaultRenderer: "soft",
  }),
);

class CaveScene extends Scene {
  readonly name = "cave";
  readonly lighting = { renderer: "soft" };
}

class StreetScene extends Scene {
  readonly name = "street";
  readonly lighting = { renderer: "hard" };
}
```

Which one to pick:

- `overlayLighting()` costs one Pixi `Graphics` and one mask per light, rebuilt
  whenever that light or an occluder moves, so its cost grows with the number
  of moving lights and with how much occluder outline each one reaches. It has
  no per-pixel work beyond the gradient.
- `shaderLighting()` costs one quad per light and one loop over that light's
  occluder shapes per covered pixel, so its cost grows with lit screen area
  times shapes in reach. A crowd of small lights is cheap; a few lights
  covering the whole screen against a wall of geometry is not. Lower
  `resolutionScale` to trade shadow-border agreement for fill cost.

`ShaderLightingRendererOptions` is `{ layer?, order?, resolutionScale?,
fallback? }`. `resolutionScale` defaults to `1`, where the drawn light matches
`levelAt()` pixel for pixel; the overlay's default is `0.5`.

The drawn picture equals what `levelAt()` reports, up to two sources of
rounding. The shader divides a lamp into 128 slots and rounds each hidden
stretch out to whole slots at both ends, which is 2/128 of that light's
contribution per stretch hidden from a pixel, and the light buffer holds 8
bits per channel.

Occluder shapes reach the shader through one data texture per scene, so there
is no cap on how much outline a light may reach and nothing is dropped
silently. A run is written again only for the lights that moved.

`fallback` takes another `LightingRendererFactory` and is built instead of this
renderer when the browser gives Pixi a WebGL 1 context, whose shader language
has none of what the renderer is written in. That is the one device limit the
renderer reads before drawing; a shader that fails to build on a context that
does have the language is reported to the browser console by Pixi and by the
driver, not to the factory, so nothing answers it. A scene on a WebGL 1
context with no `fallback` throws when it is entered, naming the option.

```ts
import { overlayLighting, shaderLighting } from "@yagejs/lighting";

shaderLighting({ fallback: overlayLighting() });
```

The renderer ships a WebGL shader and a WebGPU shader. Both draw the same
picture from the same uniforms and the same edge texture.

## Bounced light

`bounce` combines the finished light buffer with a blurred, low-resolution
copy of itself, so light creeps past shadow edges and around corners. It is a scene
setting, beside `renderer`, because it is a look: a cave wants a lot of it and
a lit street very little. It is off unless set, and it never changes what
`levelAt()` reports.

```ts
import { Scene } from "@yagejs/core";

class CaveScene extends Scene {
  readonly name = "cave";
  readonly lighting = {
    bounce: {
      strength: 0.8, // 0..1, how strongly the blurred copy shows
      radius: 90, // blur radius in screen pixels
      blend: "max", // "max" (default) or "mix"
    },
  };
}
```

`blend` says how the blurred copy meets the light:

- `"max"`, the default, keeps the brighter of the two in each colour channel.
  Lit areas and shadow borders stay as drawn and only the dark is lifted, up to
  `strength` times the blurred copy. It suits the shader renderer, whose soft
  borders it leaves alone.
- `"mix"` blends the whole picture toward the blurred copy by `strength`. The
  scene's overall brightness stays the same, every shadow edge softens, and the
  brightest spots dim slightly. It suits the overlay, whose hard edges it
  softens.

`LightingConfig.bounce` is the default for scenes that set none:

```ts yage-context="engine"
import { Scene } from "@yagejs/core";
import { LightingPlugin } from "@yagejs/lighting";

engine.use(new LightingPlugin({ bounce: { strength: 0.4, radius: 40 } }));

class MenuScene extends Scene {
  readonly name = "menu";
  readonly lighting = { bounce: null }; // no bounce, whatever the default is
}
```

Leaving `bounce` off the scene takes the plugin's value; `null` leaves that
scene without bounce. Both are read once, when the scene is entered, and a
scene's value is checked there with an error naming the scene. The extra pass
costs one more offscreen buffer per scene and runs only on frames where the
light buffer itself was redrawn.

`radius` is virtual pixels of blur reach and does not follow the renderer's
`resolutionScale`: the blurred copy is drawn at a fixed low density of its own,
so lowering `resolutionScale` sharpens nothing about the bounce and softens
nothing either.

## LightSource

Add `LightSource` to an entity with a `Transform`:

```ts yage-context="scene"
import { Transform, Vec2 } from "@yagejs/core";
import { LightSource } from "@yagejs/lighting";

const torch = scene.spawn("torch");
torch.add(new Transform({ position: new Vec2(320, 180) }));
const light = torch.add(
  new LightSource({
    radius: 180, // required; world pixels, above 0
    intensity: 0.9, // 0..1; default 1
    color: 0xffb060, // default 0xffffff
    size: 24, // lamp diameter in world pixels; default 0
    cone: {
      angle: Math.PI / 3, // spotlight spread; omit for every direction
      softness: 0.4, // 0..1 share of the spread the edge fades over; default 0
    },
    castShadows: true, // default true
    enabled: true, // default true
  }),
);
```

The centre follows `Transform.worldPosition`, including parent transforms.
Transform scale does not change `radius`. Set `light.radius`,
`light.intensity`, `light.color`, `light.size`, `light.coneAngle`,
`light.coneSoftness`, or `light.castShadows` to update a live light. Disabling the component or its
entity removes it until it becomes active again.

`radius` is how far the light reaches and `size` is how wide the lamp itself
is. A lamp wider than a point is partly hidden behind a blocker's edge, so its
shadows carry a soft border and a partly covered point dims rather than
switching off. The border widens with the distance from the blocker. At
`size: 0` a light is a point and its shadows have hard edges.

`cone` narrows a light to a spotlight of that full spread in radians, pointing
along the entity's world rotation, and `light.coneAngle` reads or sets it. A
whole turn, `Math.PI * 2`, is the default and reaches every direction. A cone
changes where light lands in the query as well as in the picture.

`cone.softness` runs from 0 to 1 and says how much of the spread the light
fades over at the cone's edge, with `light.coneSoftness` reading or setting it.
At `0` the cone ends on a line. A whole-turn cone reaches every direction, so
softness does nothing to it. The fade is in the query as well, so a guard
half-way into a soft edge reads as half lit.

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
Source colours do not change the scalar query. A source with a cone
contributes only to the points its cone covers.

Each source's contribution is scaled by the share of its lamp the point can
see. The lamp is a line of width `size` centred on the light and square to the
direction from the point to it; every occluder's outline is projected onto
that line, the projections are merged, and the unblocked share is what is
left. Touching an edge or a corner counts as blocked, so two occluders that
meet leave no gap. An occluder that contains the light does not block it, so a
lamp mounted on a pillar still lights the room. A point inside an occluder is
dark for every light outside it.

At `size: 0` the share is 1 or 0 and the rule reduces to the straight line
from the light to the point missing every enabled occluder.

Sample a whole grid in one call with `levelGridInto`:

```ts
import { Component } from "@yagejs/core";
import { LightingWorldKey } from "@yagejs/lighting";
import type { LightGrid } from "@yagejs/lighting";

const grid: LightGrid = {
  x: 0, // world x of the region's left edge
  y: 0, // world y of the region's top edge
  cols: 40,
  rows: 20,
  cellWidth: 16,
  cellHeight: 16,
};

class LightField extends Component {
  private readonly lighting = this.service(LightingWorldKey);
  private readonly levels = new Float32Array(grid.cols * grid.rows);

  update(): void {
    this.lighting.levelGridInto(this.levels, grid); // returns the same buffer
  }

  levelAtCell(col: number, row: number): number {
    return this.levels[row * grid.cols + col] ?? 0; // 0..1 at that cell's centre
  }
}
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

```ts yage-context="component"
import { LightingWorldKey } from "@yagejs/lighting";

const lighting = this.service(LightingWorldKey);

lighting.sources; // ReadonlySet<LightSource>
lighting.occluders; // ReadonlySet<LightOccluder>
lighting.ambientLevel;
lighting.ambientColor;
```

## LightOccluder

Occluders are renderer-neutral data centred on an entity's `Transform`:

```ts
import type { Entity } from "@yagejs/core";
import { LightOccluder } from "@yagejs/lighting";

declare const wall: Entity, pillar: Entity, rock: Entity; // each has a Transform

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

A wide lamp costs more to query than a point lamp, because every occluder in
reach is projected onto the lamp rather than tested once for a hit: about
3 ms for point lamps and about 10 ms for 24-pixel lamps, for one
`levelGridInto` call over 14,400 cells with 50 lights of radius 200 and 400
box occluders.

Both `LightSource` and `LightOccluder` expose world coordinates as an immutable
`position: Vec2` and as `getPositionInto(out: Vec2Buffer): Vec2Buffer`.
For repeated reads, reuse a buffer from `@yagejs/core`:

```ts
import { Vec2Buffer } from "@yagejs/core";
import type { LightOccluder, LightSource } from "@yagejs/lighting";

const position = new Vec2Buffer(); // allocate once, reuse for every read

function readPositions(light: LightSource, occluder: LightOccluder): void {
  light.getPositionInto(position);
  occluder.getPositionInto(position);
}
```

`getPositionInto` overwrites and returns the supplied buffer without
constructing a `Vec2`. The buffer holds world pixels, including parent
transforms, and stays unchanged until overwritten. Use `position` for an
immutable value you retain or share.

## Custom renderer

An entry of `LightingConfig.renderers` is a `LightingRendererFactory`:

```ts yage-context="engine"
import { LightingPlugin } from "@yagejs/lighting";
import type {
  LightingRenderer,
  LightingRendererFactory,
} from "@yagejs/lighting";

const glow: LightingRendererFactory = ({ scene, world, renderer, bounce }) => {
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

engine.use(
  new LightingPlugin({ renderers: { glow }, defaultRenderer: "glow" }),
);
```

YAGE creates one backend per entered scene. Renderer callbacks are attributed
through the engine error boundary and still rethrow.

`LightingComposite` is the last step every built-in renderer uses, and a custom
renderer that draws its light into a container can reuse it. It owns the
offscreen buffer, multiplies it over the scene, and applies the `bounce` the
factory was handed, which is the scene's own setting, or the plugin's, or
`null`:

```ts
import { Container } from "pixi.js";
import { LightingComposite } from "@yagejs/lighting";
import type { LightingRendererFactory } from "@yagejs/lighting";
import { SceneRenderTreeKey } from "@yagejs/renderer";

const composited: LightingRendererFactory = ({ scene, renderer, bounce }) => {
  const lightContainer = new Container();
  const layer = scene
    .use(SceneRenderTreeKey)
    .ensureLayer({ name: "lighting", order: 900, space: "screen" });

  const composite = new LightingComposite(renderer, {
    source: lightContainer, // what this renderer draws into
    parent: layer.container, // a screen-space layer
    width: renderer.virtualSize.width,
    height: renderer.virtualSize.height,
    resolutionScale: 0.5,
    bounce,
  });

  return {
    render() {
      // Per frame: invalidate() after the light changed, then render().
      composite.invalidate();
      composite.render(); // true when the buffer was redrawn
    },
    destroy() {
      // Before the source container goes:
      composite.destroy();
      lightContainer.destroy({ children: true });
    },
  };
};
```

A custom renderer that draws shadows should apply the rule `levelAt()` applies,
or the drawn light and the queried light disagree. The query is the truth
whichever renderer a scene uses.
