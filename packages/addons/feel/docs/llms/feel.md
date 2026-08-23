# @yagejs-addons/feel

Named, composable game-feel cues. Root entry uses `@yagejs/core` only.
Optional entries: `/renderer`, `/audio`, `/particles`.

```ts
const feel = entity.add(
  new Feel({
    hit: feelParallel(
      feelSquash({ target: visualTransform, amount: 0.2 }),
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

- `feelPositionPunch({ offset, target?, duration?, peakAt?, ... })`
- `feelRecoil({ direction, distance?, target?, duration? })`
- `feelBounce({ distance?, target?, duration? })`
- `feelRotationPunch({ radians, target?, duration?, peakAt?, ... })`
- `feelRotationShake({ radians?, frequency?, decay?, target?, duration? })`
- `feelScalePunch({ scale?, target?, duration?, peakAt?, ... })`
- `feelSquash({ axis?, amount?, target?, duration?, peakAt?, ... })`
- `feelTransformShake({ amplitude?, frequency?, decay?, target?, duration? })`
- `feelHitStop({ duration?, key?, label? })`
- `feelSlowMotion({ scale?, duration?, includeOwner?, key?, label? })`
- `feelAnimation(name, target?)`
- `feelCall(callback, label?)`

Transform targets default to the host entity's `Transform`. Position and
rotation effects are additive; scale effects are multiplicative. For a physics
entity, target a child visual entity's `Transform`. Use physics APIs for
mechanical knockback.

## `/renderer`

```ts
feelCameraShake({ camera, intensity?, duration?, decay? });
feelCameraZoom({ camera, scale?, duration?, peakAt?, ... });
feelEffect(host: EffectsHost, factory: EffectFactory, options?);
feelHitFlash(host: EffectsHost, options?: HitFlashOptions);
feelShockwave(host: EffectsHost, options?: ShockwaveOptions & { center? });
feelOpacity({ target, alpha?, duration?, peakAt? });
feelBlink({ target, duration?, interval? });
```

`feelEffect` attaches the supplied effect factory, pulses primary intensity
from 0 to the cue-scaled peak and back, then removes it.

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

Overlapping `feelParticleEmit` windows share the emitter. The final window
stops the emitter only when the emitter was idle before the first window.

## Time behavior

Hit stop and slow motion issue timed `SceneTime` requests. Their timers use
raw scene time and compose through the supplied channel key. The requests
expire independently after they start; stopping the cue does not release an
already-issued time request.

Cues and in-flight playback are transient and are not saved.
