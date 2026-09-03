# @yagejs/particles

Depends on `@yagejs/core`, `@yagejs/renderer`. Pooled particle emitters.

## Setup

```ts
import { ParticlesPlugin } from "@yagejs/particles";
engine.use(new ParticlesPlugin());
```

## ParticleEmitterComponent

```ts
import { ParticleEmitterComponent } from "@yagejs/particles";

entity.add(
  new ParticleEmitterComponent({
    texture: particleTex, // TextureInput — a texture, handle, or asset key
    // shape: "softCircle",     // built-in shape, no asset needed
    maxParticles: 200, // default 100
    rate: 20, // particles/sec, default 10
    lifetime: [0.5, 1.5], // seconds (required)
    speed: [50, 150], // px/s
    angle: [-Math.PI, Math.PI], // radians
    scale: { start: 1, end: 0 }, // Lerped
    alpha: { start: 1, end: 0 },
    rotation: 0, // radians
    rotationSpeed: 0, // rad/s
    tint: 0xff6600,
    blendMode: "add", // whole-emitter, defaults to the layer's mode
    gravity: { x: 0, y: 200 }, // px/s²
    damping: 0, // 0–1
    spawnOffset: { x: [-10, 10], y: 0 }, // or { radius, angle } for a ring
    radialSpeed: -110, // px/s along the spawn offset; negative is inward
    simulationSpace: "world", // or "local" to follow the emitter
    layer: "effects",
  }),
);
```

NumberRange: `number | [min, max]`. Lerped: `{ start: NumberRange, end: NumberRange }`.

`texture` and `shape` are mutually exclusive — setting both is a type error.
Both are optional: `new ParticleEmitterComponent({ lifetime: 1 })` renders
white square particles with no asset. A string `texture` is an asset key and
resolves like every other key-based surface: an unloaded key throws and names
the key. The default
`"pixel"` is 1×1, so set `scale` (or a shape `size`) for a visible size; the
other shapes are 64px and already visible at `scale: 1`.

## Built-in shapes

```ts
type ParticleShape =
  | "pixel"        // white rectangle; 1×1 by default (shared Texture.WHITE)
  | "circle"       // solid disc, ellipse on a non-square size
  | "softCircle"   // disc fading to transparent at the edge
  | "diamond"      // solid diamond
  | "softDiamond"  // diamond fading to transparent — reads as a 4-point sparkle
  | "line";        // filled streak, 64×8 by default

type ShapeSize = number | [width: number, height: number];
interface ShapeConfig { type: ParticleShape; size?: ShapeSize }

shape?: ParticleShape | ShapeConfig
shapeTexture(shape: ParticleShape | ShapeConfig): TextureResource
```

```ts
{ shape: "softCircle" }                            // 64×64
{ shape: { type: "softCircle", size: 16 } }        // 16×16 texture
{ shape: { type: "circle", size: [32, 16] } }      // ellipse
{ shape: { type: "line", size: [4, 32] } }         // vertical streak (rain)
```

Shapes are white — set `tint` to color them. `size` is the generated texture's
size in pixels, which at the default `scale: 1` is also the size a particle
covers on screen. Every distinct size generates and caches its own texture, so
keep to a few and vary per-particle size with `scale`. Default size is 64×64,
`line` 64×8, `pixel` 1×1. A non-square size stretches the shape into it; no
shape forces an aspect ratio. `pixel` and `line` fill their texture edge to
edge; the other four antialias their outline inside it, over one pixel, and
fill their texture instead once they get too thin for an outline (3px or less
on either axis). Every shape is visible at every size, down to 1×1. `line` at
its default is horizontal — either size it vertically or set `rotation` to aim
it along travel. A size must be a finite number above 0; anything else throws.

Each type+size pair is generated on first use and shared by every emitter
asking for it: never destroy the texture `shapeTexture` returns. Generation
writes an RGBA buffer directly, so it needs no DOM or renderer. A 1×1 `pixel` is
`Texture.WHITE` and generates nothing.

Control:

```ts
emitter.emit(); // start continuous
emitter.stop(); // stop only emission started by emit()
const request = emitter.requestEmission(); // ParticleEmissionHandle
request.release(); // release only this request; idempotent
emitter.burst(50); // spawn at the entity's world position
emitter.burst(10, x, y); // burst at an explicit world position
emitter.isEmitting; // boolean
emitter.activeCount; // number
emitter.blendMode = "add"; // BlendMode, read/write
```

Manual emission and temporary requests compose. `isEmitting` stays true while
`emit()` is active or at least one `ParticleEmissionHandle` is active.
`stop()` does not cancel requests, and releasing a request does not cancel
manual emission or other requests. Requests are transient and invalidated
when the emitter is destroyed.

**`blendMode`** is per emitter — every particle it spawns blends the same way,
and the mode cannot vary particle by particle. Overlapping particles within one
emitter still accumulate, so `"add"` is what makes fire, sparks, and magic
brighten where they pile up. Same `BlendMode` values and same
`import "pixi.js/advanced-blend-modes"` requirement as the renderer's visual
components (see `renderer.md`).

Continuous emission and a no-argument `burst` both spawn at the entity's
`Transform.worldPosition`, so a child entity emits where it is drawn, not at
its parent's origin. Each particle is drawn centred on its spawn point and
`rotationSpeed` turns it about its own centre — for a shape and for your own
texture alike.

The emitter's container follows the entity's position, so a layer sort reads
it like any other visual: `ySort` keys an emitter off its entity, and
`ySortBy` reads a depth offset you set on `emitter.container`.

**`simulationSpace`** decides what happens to particles already in flight when
the emitter moves. `"world"` (default) leaves them where they were drawn —
a torch trail stays behind the walking torch. `"local"` carries them with the
emitter, which is what an aura, a shield, or a charge-up glow needs. Position
only: the emitter's rotation and scale are not applied.

**A ring spawn plus `radialSpeed`** makes particles fly outward from, or
converge on, where they spawned:

```ts
new ParticleEmitterComponent({
  lifetime: 0.4,
  spawnOffset: { radius: 42 }, // start on a ring (add `angle` for an arc)
  radialSpeed: -110, // px/s inward; positive flies outward
});
```

`radialSpeed` adds to the velocity `speed` and `angle` produce, so the two
compose. It needs a `spawnOffset` — a particle at the emitter's origin has no
outward direction — and a particle whose offset resolves to exactly (0, 0)
takes no radial term.

**Numeric config is checked at construction.** Every number in the config must
be finite, `lifetime` above 0, `damping` between 0 and 1, `rate` at least 0,
and `maxParticles` a whole number at least 0. A value outside its range throws
a plain `Error` naming the option and the value, before the emitter allocates
anything.

**An emitter needs a `Transform` on the same entity.** `ParticleSystem` queries
`[Transform, ParticleEmitterComponent]`, so without one the emitter never runs:
no continuous emission, and `burst` particles stay frozen forever. The first
`emit()` or `burst()` on such an entity logs a warning once.

## ParticlePresets

```ts
import { ParticlePresets } from "@yagejs/particles";

fire(textureOrKey?: TextureInput): EmitterConfig    // warm, upward, shrinking
smoke(textureOrKey?: TextureInput): EmitterConfig   // slow, expanding, fading
sparks(textureOrKey?: TextureInput): EmitterConfig  // fast, short, gravity
rain(textureOrKey?: TextureInput): EmitterConfig    // downward, uniform
```

```ts
new ParticleEmitterComponent(ParticlePresets.fire()); // zero assets
new ParticleEmitterComponent(ParticlePresets.fire(myTex)); // your own art
```

With no argument each preset falls back to its own built-in shape, sized to the
effect: `fire` `softCircle` 32, `smoke` `softCircle` 40, `sparks` `line` 10×3,
`rain` `line` 2×20. The on-screen particle size lives in that `size`, so preset
`scale` values are animation and variation centred on 1 — with your texture the
effect animates it at its natural size.

Spreading overrides anything except the texture source:

```ts
{ ...ParticlePresets.fire(), rate: 50, tint: 0x00ccff }  // ok
{ ...ParticlePresets.fire(), texture: myTex }            // type error: two sources
{ ...ParticlePresets.fire(myTex), rate: 50 }             // pass the source as the argument
```
