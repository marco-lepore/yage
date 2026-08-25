# @yagejs-addons/feel

Compose the small responses that make an action readable and satisfying, then
play them from one named trigger.

The [playable example](../../../examples/feel-addon.html) groups the effects
across two scenes. It covers impacts, trails, afterimages, highlights, punches,
visibility, cue composition, slow motion, animation, callbacks, shockwaves,
camera modifiers, and a custom effect. Press `N` or `P` to move between scenes
with a slide transition.

```ts
import { Feel, feelHitStop, feelParallel } from "@yagejs-addons/feel";
import {
  feelCameraShake,
  feelHitFlash,
  feelScalePunch,
  feelSquash,
} from "@yagejs-addons/feel/renderer";

enemy.add(
  new Feel({
    hit: feelParallel(
      feelSquash({ target: enemySprite, amount: 0.2 }),
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
      effect: feelScalePunch({ target: playerSprite, scale: 1.15 }),
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

- `feelHitStop` and `feelSlowMotion`
- `feelAnimation` and `feelCall`

## Renderer effects

Import these from `@yagejs-addons/feel/renderer`:

- `feelPositionPunch`, `feelRecoil`, and `feelBounce`
- `feelRotationPunch` and `feelRotationShake`
- `feelScalePunch`, `feelScaleShake`, `feelSquash`, and `feelTransformShake`
- `feelCameraShake`, `feelCameraRotation`, and `feelCameraZoom`
- `feelHitFlash` and `feelShockwave`
- `feelOutline`, `feelGlow`, and `feelColorize`
- `feelOpacity` and `feelBlink`
- `feelFloatingText`, `feelDamageNumber`, and `feelImpactRing`
- `feelFlightLines`, `feelMotionTrail`, and `feelAfterimage`
- `feelEffect`, which pulses any `EffectHandle` from zero to its peak and back

Motion effects target a `VisualComponent`, such as `SpriteComponent`. They
add render-only position and rotation offsets and multiply render-only scale.
The entity's `Transform`, rigid body, collider, and depth-sort position remain
unchanged. Overlapping effects own separate modifiers and remove only their
own values.

```ts
import { bloom } from "@yagejs/effects";
import { feelEffect } from "@yagejs-addons/feel/renderer";

const bloomPulse = feelEffect(worldLayer.fx, bloom({ bloomScale: 1.5 }), {
  duration: 0.25,
  peakAt: 0.2,
});
```

## Highlights and combat callouts

Outline, glow, and colorize effects pulse a filter on one visual. Floating
text, damage numbers, and impact rings spawn independent world-space visuals,
so retriggers can overlap without sharing state. Feel-owned filter pulses are
omitted from save snapshots.

```ts
const criticalHit = feelParallel(
  feelOutline({
    target: enemySprite,
    color: 0xffd54a,
    thickness: 3,
    duration: 0.25,
  }),
  feelGlow({ target: enemySprite, color: 0xff8800, duration: 0.3 }),
  feelDamageNumber({
    value: () => lastDamage,
    critical: () => lastHitWasCritical,
    prefix: "-",
    layer: "effects",
  }),
  feelImpactRing({ color: 0xffd54a, layer: "effects" }),
);
```

## Flight lines, motion trails, and afterimages

`feelFlightLines` creates a short directional streak field. `feelMotionTrail`
samples a live world position and draws a fading line through recent samples.
`feelAfterimage` leaves tinted copies of a sprite's current frame behind its
rendered pose. All three effects own temporary entities and leave gameplay
transforms unchanged.

```ts
const dash = feelParallel(
  feelFlightLines({ direction: velocity, duration: 0.25 }),
  feelMotionTrail({
    position: () => player.get(Transform).worldPosition,
    duration: 0.3,
    lifetime: 0.18,
  }),
  feelAfterimage({
    target: playerSprite,
    count: 5,
    interval: 0.05,
    tint: 0x1e3a8a,
  }),
);
```

Afterimages accept `SpriteComponent` and `AnimatedSpriteComponent`. Each copy
captures the current animation frame, anchor, effective rendered transform,
and opacity. Copies fade independently and are removed on completion or
cancellation.

`feelFloatingText` and `feelDamageNumber` use the cue entity's world
`Transform` by default. Pass `position` to spawn elsewhere. Each playback
creates one temporary entity and destroys it when the effect completes or is
cancelled. Active callouts are omitted from save snapshots. Use a custom pool
instead when a game displays very large numbers of callouts every frame.

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
