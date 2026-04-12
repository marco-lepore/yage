# @yage/particles

Depends on `@yage/core`, `@yage/renderer`. Pooled particle emitters.

## Setup

```ts
import { ParticlesPlugin } from "@yage/particles";
engine.use(new ParticlesPlugin());
```

## ParticleEmitterComponent

```ts
import { ParticleEmitterComponent } from "@yage/particles";

entity.add(new ParticleEmitterComponent({
  texture: particleTex,        // TextureInput
  // textureKey: "assets/p.png", // serializable alternative
  maxParticles: 200,            // default 100
  rate: 20,                     // particles/sec, default 10
  lifetime: [0.5, 1.5],        // seconds (required)
  speed: [50, 150],            // px/s
  angle: [-Math.PI, Math.PI],  // radians
  scale: { start: 1, end: 0 }, // Lerped
  alpha: { start: 1, end: 0 },
  rotation: 0,                 // radians
  rotationSpeed: 0,            // rad/s
  tint: 0xff6600,
  gravity: { x: 0, y: 200 },  // px/s²
  damping: 0,                  // 0–1
  spawnOffset: { x: [-10, 10], y: 0 },
  layer: "effects",
}));
```

NumberRange: `number | [min, max]`. Lerped: `{ start: NumberRange, end: NumberRange }`.

Control:
```ts
emitter.emit();              // start continuous
emitter.stop();              // stop (existing continue)
emitter.burst(50);           // immediate spawn
emitter.burst(10, x, y);    // burst at position
emitter.isEmitting;          // boolean
emitter.activeCount;         // number
```

## ParticlePresets

```ts
import { ParticlePresets } from "@yage/particles";

ParticlePresets.fire(texture);    // warm, upward, shrinking
ParticlePresets.smoke(texture);   // slow, expanding, fading
ParticlePresets.sparks(texture);  // fast, short, gravity
ParticlePresets.rain(texture);    // downward, uniform

// Override properties
entity.add(new ParticleEmitterComponent({
  ...ParticlePresets.fire(tex),
  rate: 50,
  tint: 0x00ccff,
}));
```
