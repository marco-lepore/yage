# @yagejs-addons/feel

Named, composable game-feel cues. Root entry uses `@yagejs/core` only.
Optional entries: `/renderer`, `/audio`, `/particles`.

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
    options?: { intensity?: number },
  ): FeelPlaybackHandle | null;
  stop(name?: string): void;
  isPlaying(name?: string): boolean;
}
```

`play()` returns `null` while the component is dormant or when chance,
cooldown, or `overlap: "ignore"` rejects the trigger. Disabling or destroying
`Feel` cancels active cues. The host emits `FeelStartedEvent`,
`FeelCompletedEvent`, and `FeelStoppedEvent`.

## Composition

```ts
feelParallel(...nodes: FeelNode[]): FeelNode;
feelSequence(...nodes: FeelNode[]): FeelNode;
feelDelay(seconds: number, node?: FeelNode): FeelNode;
feelRepeat(node: FeelNode, times: number, gap?: number): FeelNode;
defineFeelEffect(duration, create): FeelNode;
```

Every effect leaf gets `FeelEffectContext` with `entity`, `cue`, `intensity`,
the scene `random`, `resolve(ServiceKey)`, and guarded `invoke(label, fn)`.

## Root effects

- `feelHitStop({ duration?, key?, label? })`
- `feelSlowMotion({ scale?, duration?, includeOwner?, key?, label? })`
- `feelAnimation(name, target?)`
- `feelCall(callback, label?)`

## `/renderer`

```ts
feelPositionPunch({ target, offset, duration?, peakAt?, ... });
feelRecoil({ target, direction, distance?, duration? });
feelBounce({ target, distance?, duration? });
feelRotationPunch({ target, radians, duration?, peakAt?, ... });
feelRotationShake({ target, radians?, frequency?, decay?, duration? });
feelScalePunch({ target, scale?, duration?, peakAt?, ... });
feelScaleShake({ target, amplitude?, frequency?, decay?, duration? });
feelSquash({ target, axis?, amount?, duration?, peakAt?, ... });
feelTransformShake({ target, amplitude?, frequency?, decay?, duration? });
feelCameraShake({ camera, intensity?, duration?, frequency?, decay? });
feelCameraRotation({ camera, radians?, duration?, peakAt?, ... });
feelCameraZoom({ camera, scale?, duration?, peakAt?, ... });
feelEffect(host: EffectsHost, factory: EffectFactory, options?);
feelHitFlash(host: EffectsHost, options?: HitFlashOptions);
feelShockwave(host: EffectsHost, options?: ShockwaveOptions & { center? });
feelOutline({ target, thickness?, color?, alpha?, quality?, knockout?, duration?, peakAt?, ... });
feelGlow({ target, color?, distance?, outerStrength?, innerStrength?, alpha?, quality?, knockout?, duration?, peakAt?, ... });
feelColorize({ target, color, strength?, duration?, peakAt?, ... });
feelOpacity({ target, alpha?, duration?, peakAt? });
feelBlink({ target, duration?, interval? });
feelFloatingText({ text, position?, style?, offset?, travel?, spread?, sway?, layer?, duration?, fadeAt?, startScale?, peakScale?, peakAt?, settleAt? });
feelDamageNumber({ value, critical?, prefix?, suffix?, format?, position?, color?, criticalColor?, fontSize?, criticalSize?, outlineColor?, outlineWidth?, style?, criticalStyle?, rise?, spread?, sway?, layer?, duration?, fadeAt? });
feelImpactRing({ position?, radius?, expand?, thickness?, color?, spikes?, spikeLength?, layer?, duration?, startScale? });
feelFlightLines({ position?, direction?, count?, length?, width?, spread?, depth?, travel?, color?, alpha?, layer?, duration? });
feelMotionTrail({ position?, duration?, lifetime?, sampleInterval?, minDistance?, maxPoints?, width?, taper?, color?, alpha?, layer? });
feelAfterimage({ target, count?, interval?, lifetime?, tint?, alpha?, endScale?, layer?, blendMode? });
```

Visual motion targets a `VisualComponent`. Each playback owns a renderer
modifier: position and rotation add, while scale and opacity multiply.
Visibility modifiers combine with logical AND. The renderer recomputes the
final value from the current base state and all active modifiers every frame.
Removing a playback removes only its modifier. Gameplay `Transform` and
physics state are not changed.

Camera shake and zoom use the camera's modifier host. Camera position and
rotation modifiers add; zoom modifiers multiply. Coordinate conversion and
rendered camera layers use the effective values.

`feelEffect` attaches the supplied effect factory, pulses primary intensity
from 0 to the cue-scaled peak and back, then removes it.

`feelOutline`, `feelGlow`, and `feelColorize` are target-resolving convenience
effects over the same handle lifecycle. Feel attaches all filter pulses with
`save: false`, so snapshots do not restore a temporary filter without its
playback. Floating text, damage numbers, and impact rings resolve their world
position once when playback starts. Position defaults to the cue entity's
`Transform.worldPosition`.

Each floating text, damage number, or impact ring playback spawns a separate
transient entity. The entity is destroyed on completion or cancellation, so
overlapping callouts do not restore or mutate one another. Text uses a centered
`TextComponent`; impact rings use `GraphicsComponent`. Active callouts are not
saved. Pass `layer` to choose their render layer. Use a custom pool for
callout-heavy games.

`feelFlightLines` owns a temporary directional streak field.
`feelMotionTrail` samples its live `position` source for `duration` seconds,
then keeps the temporary line alive for `lifetime` seconds so its last segments
fade. Completion and cancellation destroy the temporary entity. Neither effect
writes to the sampled `Transform`.

`feelAfterimage` accepts a `SpriteComponent`, `AnimatedSpriteComponent`, or a
function that returns one. It samples the current animation frame and effective
rendered pose, then leaves `count` tinted sprite copies at `interval` seconds.
Each copy fades for `lifetime` seconds and can scale toward `endScale` before
being destroyed. Completion and cancellation remove all remaining copies. The
source component and its `Transform` are not changed.

Game-specific effects use `defineFeelEffect(duration, create)`. `create`
returns optional `start`, `update(progress, dt)`, and `finish(cancelled)` hooks.
Acquire owner handles in `start` and release them in `finish`. Developer
callbacks can use `context.invoke(label, callback)` for error attribution.

## `/audio`

```ts
feelSound({
  alias: string,
  channel?: string,
  volume?: number,
  speed?: FeelRange,
  once?: boolean,
});
```

## `/particles`

```ts
feelParticleBurst({ emitter, count: number | [min, max], position? });
feelParticleEmit({ emitter, duration? });
```

Each `feelParticleEmit` playback owns a `ParticleEmissionHandle`. Releasing
one handle does not stop manual emission or another active request.

## Time behavior

Hit stop and slow motion issue timed `SceneTime` requests. Their timers use
raw scene time and compose through the supplied channel key. The requests
expire independently after they start; stopping the cue does not release an
already-issued time request.

Cues and in-flight playback are transient and are not saved.
