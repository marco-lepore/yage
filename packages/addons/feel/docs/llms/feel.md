# @yagejs-addons/feel

Named, composable game-feel cues. Root entry uses `@yagejs/core` only.
Optional entries: `/renderer`, `/audio`, `/particles`, `/recipes`.

```ts
const feel = entity.add(
  new Feel({
    hit: feelParallel(
      feelSquash({ target: sprite, amount: 0.2 }),
      feelHitStop({ duration: 0.05 }),
    ),
  }),
);
feel.play("hit");
```

## Cue types

```ts
type FeelOverlap = "restart" | "ignore" | "allow";
type FeelRange = number | readonly [min: number, max: number];

interface FeelPulseTiming {
  duration?: number;
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

interface FeelCueOptions {
  effect: FeelNode;
  overlap?: FeelOverlap; // default "restart"
  chance?: number; // 0..1, default 1
  cooldown?: number; // scaled seconds, default 0
  intensity?: FeelRange; // default 1
}

class Feel extends Component {
  constructor(cues: Readonly<Record<string, FeelNode | FeelCueOptions>>);
  play(
    name: string,
    options?: { intensity?: number; duration?: number },
  ): FeelPlaybackHandle | null;
  release(name?: string): void;
  stop(name?: string): void;
  isPlaying(name?: string): boolean;
}

interface FeelPlaybackHandle {
  readonly cue: string;
  readonly active: boolean;
  readonly finished: Promise<void>;
  release(): void;
  stop(): void;
}
```

`play()` returns `null` while the component is dormant or when chance,
cooldown, or `overlap: "ignore"` rejects the trigger. Disabling or destroying
`Feel` cancels active cues. The host emits `FeelStartedEvent`,
`FeelCompletedEvent`, and `FeelStoppedEvent`.

`intensity` is a finite non-negative multiplier. Values above `1` are valid;
an adapter may clamp its final property. A play-time `duration` replaces the
total duration of a finite cue and scales all finite child timings. A positive
duration cannot stretch a zero-duration cue, and a dynamic cue rejects any
duration override. Invalid play options throw before restart overlap cancels an
active playback.

`FeelPlaybackHandle.release()` and `Feel.release(name?)` gracefully release
held states and owned sources. The handle stays active until release tails and
finite children finish, then emits `FeelCompletedEvent`. `stop()`, restart
overlap, disable, and destroy cancel immediately and emit `FeelStoppedEvent`.
`finished` resolves after either outcome.

## Composition

```ts
feelParallel(...nodes: FeelNode[]): FeelNode;
feelSequence(...nodes: FeelNode[]): FeelNode;
feelDelay(seconds: number, node?: FeelNode): FeelNode;
feelRepeat(node: FeelNode, times: number, gap?: number): FeelNode;
feelLoop(node: FeelNode, gap?: number): FeelNode;
defineFeelEffect(duration, create): FeelNode;
defineFeelState({ attack?, release?, attackEasing?, releaseEasing? }, create): FeelNode;
```

Every effect leaf gets `FeelEffectContext` with `entity`, `cue`, `intensity`,
its effective `duration`, the scene `random`, `resolve(ServiceKey)`, and guarded
`invoke(label, fn)`. Timed `update(progress, dt)` hooks receive `dt` on the
cue's local clock, so play-time retiming also scales internal cadences.

`FeelNode.duration` is `number | null`; `null` means the timeline needs release
or source completion. Parallel nodes wait for every child and owned source.
Sequences wait for a held child to release before starting later children.
Release lets active finite children finish and still runs pending sequence
children. A state reached after release skips its held phase. `feelRepeat`
accepts finite children and a fixed count. `feelLoop` accepts a finite child,
starts iterations until release, and lets the current iteration finish. A
zero-duration loop child requires a positive gap.

`defineFeelState` calls `update(amount, dt)` while `amount` attacks from `0` to
`1`, holds, and releases from its current value to `0`. Attack and release
default to zero seconds and are not affected by a play-time duration override.
The instance may provide `start`, `release`, `isComplete`, and
`finish(cancelled)`. Easing callbacks and all instance hooks use the Feel
callback boundary.

## Root effects

- `feelHitStop({ duration?, includeOwner?, excludeUpdates?, key?, label? })` — owner freezes by default; `includeOwner: false` keeps its updates running
- `feelSlowMotion({ scale?, duration?, includeOwner?, key?, label? })` — scene request; owner excluded by default
- `feelSlowMotion({ target, scale?, duration?, key?, label? })` — target-only update request
- `feelTargetFreeze({ target, duration?, key?, label? })` — target-only ×0 update request
- `feelKeyframeAnimation(name, target?)`
- `feelCall(callback, label?)`

## `/renderer`

```ts
feelSpriteAnimation(name, { target?, mode?: "play" | "force" | "oneShot", duration?, onComplete? });
feelPositionPunch({ target, offset, duration?, peakAt?, ... });
feelPositionSpring({ target, offset, duration?, oscillations?, decay? });
feelRecoil({ target, direction, distance?, duration?, peakAt?, attackEasing?, releaseEasing? });
feelBounce({ target, distance?, duration?, peakAt?, attackEasing?, releaseEasing? });
feelRotationPunch({ target, radians, duration?, peakAt?, ... });
feelRotationSpring({ target, radians, duration?, oscillations?, decay? });
feelRotationShake({ target, radians?, frequency?, decay?, duration? });
feelScalePunch({ target, scale?, duration?, peakAt?, ... });
feelScaleSpring({ target, scale?, duration?, oscillations?, decay? });
feelScaleShake({ target, amplitude?, frequency?, decay?, duration? });
feelSquash({ target, axis?, amount?, duration?, peakAt?, ... });
feelTransformShake({ target, amplitude?, frequency?, decay?, duration? });
feelCameraShake({ camera, intensity?, duration?, frequency?, decay? });
feelCameraRotation({ camera, radians?, duration?, peakAt?, ... });
feelCameraZoom({ camera, scale?, duration?, peakAt?, ... });
feelEffect(host: EffectsHost, factory: EffectFactory, timing?: FeelPulseTiming);
feelGlitch({ host, refreshRate?, slices?, offset?, direction?, red?, green?, blue?, duration?, peakAt?, releaseAt?, ... });
feelDissolve({ target, duration?, easing?, edgeColor?, edgeWidth?, noiseScale?, softness?, seed? });
feelHitFlash(host: EffectsHost, options?: FeelHitFlashOptions);
feelShockwave(host: EffectsHost, options?: ShockwaveOptions & { center? });
feelOutline({ target, thickness?, color?, alpha?, quality?, knockout?, duration?, peakAt?, ... });
feelGlow({ target, color?, distance?, outerStrength?, innerStrength?, alpha?, quality?, knockout?, duration?, peakAt?, ... });
feelColorize({ target, color, strength?, duration?, peakAt?, ... });
feelOpacity({ target, alpha?, duration?, peakAt?, attackEasing?, releaseEasing? });
feelBlink({ target, duration?, interval? });
feelFloatingText({ text, position?, style?, offset?, travel?, spread?, sway?, layer?, duration?, fadeAt?, startScale?, peakScale?, peakAt?, settleAt? });
feelDamageNumber({ value, critical?, prefix?, suffix?, format?, position?, color?, criticalColor?, fontSize?, criticalSize?, outlineColor?, outlineWidth?, style?, criticalStyle?, rise?, spread?, sway?, layer?, duration?, fadeAt? });
feelImpactRing({ position?, radius?, expand?, thickness?, color?, spikes?, spikeLength?, layer?, duration?, startScale? });
feelFlightLines({ position?, direction?, count?, length?, width?, spread?, depth?, travel?, color?, alpha?, layer?, duration? });
feelMotionTrail({ position?, duration?: number | "held", lifetime?, sampleInterval?, minDistance?, maxPoints?, width?, taper?, color?, alpha?, layer? });
feelAfterimage({ target, count?, interval?, lifetime?, tint?, alpha?, endScale?, layer?, blendMode? });
```

Visual motion targets a `VisualComponent`. Each playback owns a renderer
modifier: position and rotation add, while scale and opacity multiply.
Visibility modifiers combine with logical AND. The renderer recomputes the
final value from the current base state and all active modifiers every frame.
Removing a playback removes only its modifier. Gameplay `Transform` and
physics state are not changed.

Spring cues start at the supplied position, rotation, or scale displacement and
oscillate around neutral until removal. Defaults: `duration: 0.5`,
`oscillations: 2.5`, `decay: 2`. `oscillations` and `decay` must be finite and
greater than zero.

Camera shake and zoom use the camera's modifier host. Camera position and
rotation modifiers add; zoom modifiers multiply. Coordinate conversion and
rendered camera layers use the effective values.

`feelEffect` attaches the supplied effect factory, pulses primary intensity
from 0 to the cue-scaled peak and back, then removes it.

`FeelPulseTiming` is exported from the root entry. Pulse builders validate and
capture `duration` and `peakAt` when called. Ordinary pulses, opacity, recoil,
and bounce default to `peakAt: 0.25` with `easeOutQuad` for both phases. Hit
flash defaults to 0.12 seconds and a linear triangle at `peakAt: 0.5`. Custom
easing callbacks must return finite numbers.

`feelGlitch` adds behavior beyond a generic pulse. It replaces the glitch band
pattern at `refreshRate` from the scene's seeded random source. Its default
presence reaches full strength at `peakAt: 0.08`, stays there until
`releaseAt: 0.72`, then releases. Static bloom, pixelate, vignette, zoom blur,
axis blur, and implosion pulses use `feelEffect` directly.

`feelDissolve` advances the `dissolve` preset from intact to transparent. It
uses `easeInQuad` by default and removes the temporary filter on completion or
cancellation. Cancellation reveals the source visual again.

`feelOutline`, `feelGlow`, and `feelColorize` are target-resolving convenience
effects over the same handle lifecycle. Floating text, damage numbers, and
impact rings resolve their world position once when playback starts. Position
defaults to the cue entity's `Transform.worldPosition`.

Each floating text, damage number, or impact ring playback spawns a separate
transient entity. The entity is destroyed on completion or cancellation, so
overlapping callouts do not restore or mutate one another. Text uses a centered
`TextComponent`; impact rings use `GraphicsComponent`. Active callouts are not
saved. Pass `layer` to choose their render layer. Use a custom pool for
callout-heavy games.

`feelFlightLines` owns a temporary directional streak field. A fixed
`direction` must be finite with a magnitude greater than `1e-6` and is
validated when the node is built. A direction function is evaluated once per
burst. A finite zero or near-zero callback result creates no entity and
consumes no position sample or random values; the empty burst keeps its
configured duration.
`feelMotionTrail` samples its live `position` source for a finite `duration`,
then keeps the temporary line alive for `lifetime` seconds so its last segments
fade. Set `duration: "held"` to sample until release; release stops sampling
and uses `lifetime` as the drain tail. Completion and cancellation destroy the
temporary entity. Neither effect writes to the sampled `Transform`.

`feelAfterimage` accepts a `SpriteComponent`, `AnimatedSpriteComponent`, or a
function that returns one. It samples the current animation frame and effective
rendered pose, then leaves `count` tinted sprite copies at `interval` seconds.
Each copy fades for `lifetime` seconds and can scale toward `endScale` before
being destroyed. Completion and cancellation remove all remaining copies. The
source component and its `Transform` are not changed.

Game-specific timed effects use `defineFeelEffect(duration, create)`. `create`
returns optional `start`, `update(progress, dt)`, `release`, `isComplete`, and
`finish(cancelled)` hooks. `isComplete` lets an owned source keep the overall
playback active after the leaf's timeline step finishes. Acquire owned handles
in `start` and release them in `finish`. Developer callbacks can use
`context.invoke(label, callback)` for error attribution.

## `/recipes`

```ts
impact({ target, position?, color?, duration?, scale?, shake?, ringRadius?, ringExpand? });
damageImpact({ target, value, position?, critical?, impact?, number? });
dashBurst({ target, direction, position?, duration?, peakAt?, attackEasing?, releaseEasing?, stretch?, blur?, lines? });
spawnPop({ target, duration?, startScale?, offset?, oscillations?, decay?, glow? });
enemyDeath({ target, onComplete, position?, color?, impactDuration?, dissolveDuration?, scale?, shake?, dissolve?, glow?, ring? });
voidCollapse({ host, center?, radius?, strength?, darkness?, swirl?, expandFromCenter?, zoomStrength?, implosionDelay?, holdDuration?, color?, colorStrength?, duration?, peakAt?, ... });
```

A recipe is a ready-made composition that returns an ordinary `FeelNode`. It
does not create another `Feel` component or use a separate player.

- `impact`: hit flash, scale punch, visual shake, and an impact ring.
- `damageImpact`: `impact` plus a floating damage number. The nested `impact`
  and `number` objects configure those two parts.
- `dashBurst`: axis stretch, axis blur, and directional flight lines. The
  dominant direction component selects the axis. Its top-level pulse curve
  controls stretch and blur; `duration` also controls the flight lines.
  Defaults: `duration: 0.3`, `peakAt: 0.3`, and `easeOutQuad` for both phases.
- `spawnPop`: scale and position springs plus a short glow.
- `enemyDeath`: impact flash, ring, scale punch, shake, glow, and edged
  dissolve. `onComplete` runs after the temporary handles are removed and does
  not run when playback is cancelled. The caller decides whether to destroy,
  pool, hide, or replace the enemy.
- `voidCollapse`: inward `zoomBlur`, a slightly delayed `implosion`, a held
  peak, and an optional `colorize` pass. The implosion radius grows from its
  center by default. Set `expandFromCenter: false` for whole-radius pull, or
  `color: false` to omit color.

Recipes do not add sound, camera movement, time changes, or particles. No
recipe destroys an entity by itself.

## `/audio`

```ts
feelSound({
  alias: string,
  channel?: string,
  volume?: number,
  speed?: FeelRange,
  once?: boolean,
  onEnd?: () => void,
});
```

The cue owns the returned sound handle. The sound keeps the overall playback
active until it ends naturally, but remains a zero-time sequence step. Release
or cancellation stops a sound that is still playing. `onEnd` runs only after
natural audio completion. With `once: true`, each cue owns one
`AudioManager.requestOnce` request. Releasing the cue does not stop another
request or a `playOnce` owner.

## `/particles`

```ts
feelParticleBurst({ emitter, count: number | [min, max], position? });
feelParticleEmit({ emitter, duration?: number | "held" });
```

Each `feelParticleEmit` playback owns a `ParticleEmissionHandle`. Releasing
one handle does not stop manual emission or another active request. Set
`duration: "held"` to emit until graceful release. Existing particles keep
their own lifetimes after the emission request ends.

## Time behavior

Hit stop and slow motion issue timed `SceneTime` requests. Their timers use raw
scene time and compose through the supplied channel key. Target requests affect
component updates, processes, animations, and particle emitters but not
physics. Hitstop exclusions keep selected entity updates running while scene
physics remains frozen. Requests expire independently after they start;
stopping the cue does not release an already-issued time request. Finite
play-time retiming also scales the issued request duration. A positive-duration
time node advances its sequence only after its retained `TimeEffectHandle`
becomes inactive, even when its owner receives zero or scaled update time.

Cue definitions, cooldown clocks, and in-flight playback are runtime-only.
Normal entity setup constructs `Feel` when the game builds a scene, with no cue
in progress.

Renderer and camera modifiers, Feel-owned filter attachments, `SceneTime`
requests, particle-emission requests, live particles, and transient visual
entities are also omitted.

`feelCall`, custom effects, `feelKeyframeAnimation`, and
`feelSpriteAnimation` can write through user-supplied callbacks. Changes to an
explicit game-owned state root can be saved. Use renderer modifier handles for
custom visual motion that should remain a runtime effect.
