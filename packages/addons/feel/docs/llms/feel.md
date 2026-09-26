# @yagejs-addons/feel

Named, composable game-feel cues. Root entry uses `@yagejs/core` only.
Optional entries: `/renderer`, `/audio`, `/particles`, `/recipes`.

```ts yage-context="entity"
import { SpriteComponent } from "@yagejs/renderer";
import { Feel, feelHitStop, feelParallel } from "@yagejs-addons/feel";
import { feelSquash } from "@yagejs-addons/feel/renderer";

const sprite = entity.get(SpriteComponent);
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
import type { EasingFunction } from "@yagejs/core";
import {
  Feel as BaseFeel,
  type FeelCueOptions as BaseFeelCueOptions,
  type FeelNode,
  type FeelPlaybackHandle as BaseFeelPlaybackHandle,
  type FeelPulseTiming as BaseFeelPulseTiming,
} from "@yagejs-addons/feel";

type FeelOverlap = "restart" | "ignore" | "allow";
type FeelRange = number | readonly [min: number, max: number];

interface FeelPulseTiming extends BaseFeelPulseTiming {
  duration?: number;
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

interface FeelCueOptions extends BaseFeelCueOptions {
  effect: FeelNode;
  overlap?: FeelOverlap; // default "restart"
  chance?: number; // 0..1, default 1
  cooldown?: number; // scaled seconds, default 0
  intensity?: FeelRange; // default 1
}

// Feel is a Component.
declare class Feel extends BaseFeel {
  constructor(cues: Readonly<Record<string, FeelNode | FeelCueOptions>>);
  play(
    name: string,
    options?: { intensity?: number; duration?: number },
  ): FeelPlaybackHandle | null;
  release(name?: string): void;
  stop(name?: string): void;
  isPlaying(name?: string): boolean;
}

interface FeelPlaybackHandle extends BaseFeelPlaybackHandle {
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
import type {
  FeelEffectInstance,
  FeelNode,
  FeelStateContext,
  FeelStateInstance,
  FeelStateTiming,
  FeelTimedEffectContext,
} from "@yagejs-addons/feel";

declare function feelParallel(...nodes: FeelNode[]): FeelNode;
declare function feelSequence(...nodes: FeelNode[]): FeelNode;
declare function feelDelay(seconds: number, node?: FeelNode): FeelNode;
declare function feelRepeat(
  node: FeelNode,
  times: number,
  gap?: number,
): FeelNode;
declare function feelLoop(node: FeelNode, gap?: number): FeelNode;
declare function defineFeelEffect(
  duration: number,
  create: (context: FeelTimedEffectContext) => FeelEffectInstance,
): FeelNode;
declare function defineFeelState(
  timing: FeelStateTiming, // { attack?, release?, attackEasing?, releaseEasing? }
  create: (context: FeelStateContext) => FeelStateInstance,
): FeelNode;
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

For `feelSpriteAnimation`, `duration`, `onComplete`, and `onCancel` require
`mode: "oneShot"`. `onComplete` reports natural controller completion;
`onCancel` reports interruption by another one-shot, force play, unlock, or
destruction. Both callbacks are attributed through Feel's invocation context;
throws are terminal. These notifications do not determine the Feel node's
duration: an explicit duration remains retimed with the cue, and no duration
means an immediate node.

```ts
import type {
  EffectFactory,
  EffectHandle,
  EffectsHost,
} from "@yagejs/renderer";
import type { FeelNode, FeelPulseTiming } from "@yagejs-addons/feel";
import type {
  FeelAfterimageOptions,
  FeelBlinkOptions,
  FeelBounceOptions,
  FeelCameraRotationOptions,
  FeelCameraShakeOptions,
  FeelCameraZoomOptions,
  FeelColorizeOptions,
  FeelDamageNumberOptions,
  FeelDissolveOptions,
  FeelFlightLinesOptions,
  FeelFloatingTextOptions,
  FeelGlitchOptions,
  FeelGlowOptions,
  FeelHitFlashOptions,
  FeelImpactRingOptions,
  FeelMotionTrailOptions,
  FeelOpacityOptions,
  FeelOutlineOptions,
  FeelPositionPunchOptions,
  FeelPositionSpringOptions,
  FeelRecoilOptions,
  FeelRotationPunchOptions,
  FeelRotationShakeOptions,
  FeelRotationSpringOptions,
  FeelScalePunchOptions,
  FeelScaleShakeOptions,
  FeelScaleSpringOptions,
  FeelShockwaveOptions,
  FeelSpriteAnimationOptions,
  FeelSquashOptions,
  FeelTransformShakeOptions,
} from "@yagejs-addons/feel/renderer";

declare function feelSpriteAnimation<T extends string = string>(
  name: T,
  opts?: FeelSpriteAnimationOptions<T>, // { target?, mode?: "play" | "force" | "oneShot", duration?, onComplete?, onCancel? }
): FeelNode;
declare function feelPositionPunch(opts: FeelPositionPunchOptions): FeelNode; // { target, offset, duration?, peakAt?, ... }
declare function feelPositionSpring(opts: FeelPositionSpringOptions): FeelNode; // { target, offset, duration?, oscillations?, decay? }
declare function feelRecoil(opts: FeelRecoilOptions): FeelNode; // { target, direction, distance?, duration?, peakAt?, attackEasing?, releaseEasing? }
declare function feelBounce(opts: FeelBounceOptions): FeelNode; // { target, distance?, duration?, peakAt?, attackEasing?, releaseEasing? }
declare function feelRotationPunch(opts: FeelRotationPunchOptions): FeelNode; // { target, radians, duration?, peakAt?, ... }
declare function feelRotationSpring(opts: FeelRotationSpringOptions): FeelNode; // { target, radians, duration?, oscillations?, decay? }
declare function feelRotationShake(opts: FeelRotationShakeOptions): FeelNode; // { target, radians?, frequency?, decay?, duration? }
declare function feelScalePunch(opts: FeelScalePunchOptions): FeelNode; // { target, scale?, duration?, peakAt?, ... }
declare function feelScaleSpring(opts: FeelScaleSpringOptions): FeelNode; // { target, scale?, duration?, oscillations?, decay? }
declare function feelScaleShake(opts: FeelScaleShakeOptions): FeelNode; // { target, amplitude?, frequency?, decay?, duration? }
declare function feelSquash(opts: FeelSquashOptions): FeelNode; // { target, axis?, amount?, duration?, peakAt?, ... }
declare function feelTransformShake(opts: FeelTransformShakeOptions): FeelNode; // { target, amplitude?, frequency?, decay?, duration? }
declare function feelCameraShake(opts: FeelCameraShakeOptions): FeelNode; // { camera, intensity?, duration?, frequency?, decay? }
declare function feelCameraRotation(opts: FeelCameraRotationOptions): FeelNode; // { camera, radians?, duration?, peakAt?, ... }
declare function feelCameraZoom(opts: FeelCameraZoomOptions): FeelNode; // { camera, scale?, duration?, peakAt?, ... }
declare function feelEffect<H extends EffectHandle>(
  host: EffectsHost,
  factory: EffectFactory<H>,
  timing?: FeelPulseTiming,
): FeelNode;
declare function feelGlitch(opts: FeelGlitchOptions): FeelNode; // { host, refreshRate?, slices?, offset?, direction?, red?, green?, blue?, duration?, peakAt?, releaseAt?, ... }
declare function feelDissolve(opts: FeelDissolveOptions): FeelNode; // { target, duration?, easing?, edgeColor?, edgeWidth?, noiseScale?, softness?, seed? }
declare function feelHitFlash(
  host: EffectsHost,
  opts?: FeelHitFlashOptions,
): FeelNode;
declare function feelShockwave(
  host: EffectsHost,
  opts?: FeelShockwaveOptions,
): FeelNode; // ShockwaveOptions & { center? }
declare function feelOutline(opts: FeelOutlineOptions): FeelNode; // { target, thickness?, color?, alpha?, quality?, knockout?, duration?, peakAt?, ... }
declare function feelGlow(opts: FeelGlowOptions): FeelNode; // { target, color?, distance?, outerStrength?, innerStrength?, alpha?, quality?, knockout?, duration?, peakAt?, ... }
declare function feelColorize(opts: FeelColorizeOptions): FeelNode; // { target, color, strength?, duration?, peakAt?, ... }
declare function feelOpacity(opts: FeelOpacityOptions): FeelNode; // { target, alpha?, duration?, peakAt?, attackEasing?, releaseEasing? }
declare function feelBlink(opts: FeelBlinkOptions): FeelNode; // { target, duration?, interval? }
declare function feelFloatingText(opts: FeelFloatingTextOptions): FeelNode; // { text, position?, style?, offset?, travel?, spread?, sway?, layer?, duration?, fadeAt?, startScale?, peakScale?, peakAt?, settleAt? }
declare function feelDamageNumber(opts: FeelDamageNumberOptions): FeelNode; // { value, critical?, prefix?, suffix?, format?, position?, color?, criticalColor?, fontSize?, criticalSize?, outlineColor?, outlineWidth?, style?, criticalStyle?, rise?, spread?, sway?, layer?, duration?, fadeAt? }
declare function feelImpactRing(opts?: FeelImpactRingOptions): FeelNode; // { position?, radius?, expand?, thickness?, color?, spikes?, spikeLength?, layer?, duration?, startScale? }
declare function feelFlightLines(opts?: FeelFlightLinesOptions): FeelNode; // { position?, direction?, count?, length?, width?, spread?, depth?, travel?, color?, alpha?, layer?, duration? }
declare function feelMotionTrail(opts?: FeelMotionTrailOptions): FeelNode; // { position?, duration?: number | "held", lifetime?, sampleInterval?, minDistance?, maxPoints?, width?, taper?, color?, alpha?, layer? }
declare function feelAfterimage(opts: FeelAfterimageOptions): FeelNode; // { target, count?, interval?, lifetime?, tint?, alpha?, endScale?, layer?, blendMode? }
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
import type { FeelNode } from "@yagejs-addons/feel";
import type {
  DamageImpactOptions,
  DashBurstOptions,
  EnemyDeathOptions,
  ImpactOptions,
  SpawnPopOptions,
  VoidCollapseOptions,
} from "@yagejs-addons/feel/recipes";

declare function impact(opts: ImpactOptions): FeelNode; // { target, position?, color?, duration?, scale?, shake?, ringRadius?, ringExpand? }
declare function damageImpact(opts: DamageImpactOptions): FeelNode; // { target, value, position?, critical?, impact?, number? }
declare function dashBurst(opts: DashBurstOptions): FeelNode; // { target, direction, position?, duration?, peakAt?, attackEasing?, releaseEasing?, stretch?, blur?, lines? }
declare function spawnPop(opts: SpawnPopOptions): FeelNode; // { target, duration?, startScale?, offset?, oscillations?, decay?, glow? }
declare function enemyDeath(opts: EnemyDeathOptions): FeelNode; // { target, onComplete, position?, color?, impactDuration?, dissolveDuration?, scale?, shake?, dissolve?, glow?, ring? }
declare function voidCollapse(opts: VoidCollapseOptions): FeelNode; // { host, center?, radius?, strength?, darkness?, swirl?, expandFromCenter?, zoomStrength?, implosionDelay?, holdDuration?, color?, colorStrength?, duration?, peakAt?, ... }
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
import type { FeelNode, FeelRange } from "@yagejs-addons/feel";
import type { FeelSoundOptions as BaseFeelSoundOptions } from "@yagejs-addons/feel/audio";

interface FeelSoundOptions extends BaseFeelSoundOptions {
  alias: string;
  channel?: string;
  volume?: number;
  speed?: FeelRange;
  once?: boolean;
  onEnd?: () => void;
}

declare function feelSound(opts: FeelSoundOptions): FeelNode;
```

The cue owns the returned sound handle. The sound keeps the overall playback
active until it ends naturally, but remains a zero-time sequence step. Release
or cancellation stops a sound that is still playing. `onEnd` runs only after
natural audio completion. With `once: true`, each cue owns one
`AudioManager.requestOnce` request. Releasing the cue does not stop another
request or a `playOnce` owner.

## `/particles`

```ts
import type { FeelNode } from "@yagejs-addons/feel";
import type {
  FeelParticleBurstOptions,
  FeelParticleEmitOptions,
} from "@yagejs-addons/feel/particles";

declare function feelParticleBurst(opts: FeelParticleBurstOptions): FeelNode; // { emitter, count: number | [min, max], position? }
declare function feelParticleEmit(opts: FeelParticleEmitOptions): FeelNode; // { emitter, duration?: number | "held" }
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
