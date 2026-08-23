# @yagejs-addons/feel

Compose the small responses that make an action readable and satisfying, then
play them from one named trigger.

```ts
import {
  Feel,
  feelHitStop,
  feelParallel,
  feelScalePunch,
  feelSquash,
} from "@yagejs-addons/feel";
import { feelCameraShake, feelHitFlash } from "@yagejs-addons/feel/renderer";

enemy.add(
  new Feel({
    hit: feelParallel(
      feelSquash({ target: enemyVisualTransform, amount: 0.2 }),
      feelHitStop({ duration: 0.05 }),
      feelCameraShake({ camera, intensity: 5 }),
      feelHitFlash(enemySprite.fx, { color: 0xffffff }),
    ),
  }),
);

enemy.get(Feel).play("hit");
```

## Install

```bash
npm install @yagejs-addons/feel @yagejs/core

# Install only the peers used by the optional entries you import:
npm install @yagejs/renderer @yagejs/effects
npm install @yagejs/audio
npm install @yagejs/particles
```

The root entry imports only `@yagejs/core`. Renderer, audio, and particle
adapters have separate entry points.

## Compose cues

- `feelParallel(...nodes)` starts every node together.
- `feelSequence(...nodes)` starts each node after the previous one finishes.
- `feelDelay(seconds, node?)` delays a node or creates an empty wait.
- `feelRepeat(node, times, gap?)` repeats a node.
- `defineFeelEffect(duration, create)` adds a game-specific effect.

Each cue also accepts trigger policy:

```ts
const feel = entity.add(
  new Feel({
    hit: {
      effect: feelScalePunch({ scale: 1.15 }),
      overlap: "restart", // "restart" (default), "ignore", or "allow"
      chance: 0.9,
      cooldown: 0.05,
      intensity: [0.9, 1.1],
    },
  }),
);

feel.play("hit", { intensity: 1.5 });
feel.stop("hit");
```

Chance and intensity ranges use YAGE's scene-scoped random service. Disabling
or destroying `Feel` stops every active cue and restores active effects.

## Core effects

The root entry supplies:

- `feelPositionPunch`, `feelRecoil`, and `feelBounce`
- `feelRotationPunch` and `feelRotationShake`
- `feelScalePunch` and `feelSquash`
- `feelTransformShake`
- `feelHitStop` and `feelSlowMotion`
- `feelAnimation` and `feelCall`

Position and rotation contributions add together. Scale contributions
multiply. The mixer reads the live transform between updates, so ordinary
movement can continue while a cue is playing.

### Physics bodies

Shake, squash, and scale punch are visual feedback. Put the sprite on a child
entity and target that child's `Transform` when the parent has a rigid body:

```text
player (Transform + RigidBody + Collider + Feel)
└── playerVisual (Transform + Sprite)
```

Changing the rigid body's transform can turn a visual shake into collision
motion. Mechanical recoil and knockback belong in combat code and should call
the physics body's impulse or velocity API.

## Renderer effects

Import these from `@yagejs-addons/feel/renderer`:

- `feelCameraShake` and `feelCameraZoom`
- `feelHitFlash` and `feelShockwave`
- `feelOpacity` and `feelBlink`
- `feelEffect`, which pulses any `EffectHandle` from zero to its peak and back

```ts
import { bloom } from "@yagejs/effects";
import { feelEffect } from "@yagejs-addons/feel/renderer";

const bloomPulse = feelEffect(worldLayer.fx, bloom({ bloomScale: 1.5 }), {
  duration: 0.25,
  peakAt: 0.2,
});
```

## Audio and particles

```ts
import { feelSound } from "@yagejs-addons/feel/audio";
import {
  feelParticleBurst,
  feelParticleEmit,
} from "@yagejs-addons/feel/particles";

const impact = feelParallel(
  feelSound({ alias: "impact", speed: [0.95, 1.05] }),
  feelParticleBurst({ emitter: sparks, count: [8, 12] }),
  feelParticleEmit({ emitter: smoke, duration: 0.2 }),
);
```

## Playback events

The host entity emits `FeelStartedEvent`, `FeelCompletedEvent`, and
`FeelStoppedEvent`. Each payload carries the cue name and its
`FeelPlaybackHandle`. `play()` returns `null` while the component is dormant
or when chance, cooldown, or `overlap: "ignore"` rejects the trigger.
