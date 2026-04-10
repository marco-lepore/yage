# @yage/particles

Particle emitters and visual effects for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yage/particles
```

## Usage

```ts
import { Engine } from "@yage/core";
import { ParticlesPlugin, ParticleEmitterComponent, ParticlePresets } from "@yage/particles";

const engine = new Engine();
engine.use(new ParticlesPlugin());
```

Attach an emitter to an entity:

```ts
entity.add(new ParticleEmitterComponent({
  ...ParticlePresets.fire,
  rate: 60,
  lifetime: { min: 300, max: 600 },
}));
```

## What's in the box

- **ParticlesPlugin** - particle system registration
- **ParticleEmitterComponent** - per-entity emitters with config
- **ParticlePresets** - ready-made effects (fire, smoke, sparks, etc.)
- **Lerped values** - animate particle properties over lifetime
- **Object pooling** - efficient recycling of particle instances

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
