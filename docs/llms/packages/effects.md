# @yagejs/effects

Depends on `@yagejs/renderer` (peer), `pixi.js` (peer), `pixi-filters`. Built-in visual-effect presets that plug into `.fx.addEffect` at any of the four scopes (component / layer / scene / screen). Each preset is registered through `defineEffect`, so attached effects round-trip through `SaveService.saveSnapshot` / `loadSnapshot` automatically.

## Setup

No plugin install — just import a preset and call it like a factory:

```ts
import { hitFlash, bloom, crt, vignette } from "@yagejs/effects";

sprite.fx.addEffect(hitFlash({ color: 0xffffff }));
tree.get("world").fx.addEffect(bloom({ threshold: 0.8 }));
tree.fx.addEffect(crt({}));
this.use(RendererKey).fx.addEffect(vignette({ alpha: 0.4 }));
```

Each preset returns the same `EffectHandle` shape (`remove`, `setEnabled`, `enabled`, `fadeIn(duration)`, `fadeOut(duration)`) plus typed extras specific to the preset (e.g. `OutlineHandle.setThickness(n)`).

## Presets

| Preset | Options shape | Wraps | Primary intensity |
|---|---|---|---|
| `hitFlash` | `{ color?, duration?, peak? }` | built-in `ColorMatrixFilter` | additive tint amount |
| `bloom` | `{ threshold?, bloomScale?, brightness?, blur?, quality? }` | `pixi-filters` `AdvancedBloomFilter` | `bloomScale` |
| `outline` | `{ thickness?, color?, alpha?, quality?, knockout? }` | `pixi-filters` `OutlineFilter` | `thickness` |
| `dropShadow` | `{ offset?, color?, alpha?, blur?, quality?, shadowOnly? }` | `pixi-filters` `DropShadowFilter` | `alpha` |
| `pixelate` | `{ size? }` | `pixi-filters` `PixelateFilter` | `size` (clamped to ≥ 1) |
| `glow` | `{ color?, distance?, outerStrength?, innerStrength?, alpha?, quality?, knockout? }` | `pixi-filters` `GlowFilter` | scales BOTH strengths together |
| `crt` | `{ curvature?, lineWidth?, lineContrast?, verticalLine?, noise?, vignetting?, vignettingAlpha? }` | `pixi-filters` `CRTFilter` | filter `alpha` (whole effect; noise self-animates) |
| `chromaticAberration` | `{ separation? }` | `pixi-filters` `RGBSplitFilter` | symmetric `separation` (red −x, blue +x) |
| `vignette` | `{ radius?, alpha?, blur? }` | `CRTFilter` (with CRT features zeroed) | `vignettingAlpha` |
| `colorGrade` | `{ preset?, amount? }` | built-in `ColorMatrixFilter` | filter `alpha` (cross-fades to identity) |
| `godRay` | `{ angle?, gain?, lacunarity?, alpha? }` | `pixi-filters` `GodrayFilter` | `gain` (rays scale 0 → full) |
| `shockwave` | `{ speed?, amplitude?, wavelength?, brightness?, radius?, duration? }` | `pixi-filters` `ShockwaveFilter` | `amplitude × brightness` (parked off until `trigger`) |
| `motionBlur` | `{ velocity?, kernelSize?, offset? }` | `pixi-filters` `MotionBlurFilter` | configured `velocity` magnitude |
| `oldFilm` | `{ sepia?, noise?, noiseSize?, scratch?, scratchDensity?, scratchWidth?, vignetting?, vignettingAlpha?, vignettingBlur? }` | `pixi-filters` `OldFilmFilter` | filter `alpha` (whole effect; noise self-animates) |
| `bulgePinch` | `{ strength?, radius?, center? }` | `pixi-filters` `BulgePinchFilter` | configured `strength` (sign preserved) |
| `halftone` | `{ size?, amount?, angle? }` | custom WebGL+WGSL | `amount` (cross-fades back to source) |
| `wave` | `{ amplitude?, wavelength?, speed? }` | custom WebGL+WGSL | configured `amplitude` |

Color-grade presets: `"neutral"` (identity), `"sepia"`, `"grayscale"`, `"negative"`, `"night"`, `"warm"` (orange tint + brightness boost), `"cool"` (blue tint).

`motionBlur.kernelSize` must be odd and ≥ 5. Invalid values are coerced up to the nearest valid kernel and a one-shot `console.warn` fires naming the requested + final value. `bulgePinch.strength` is signed: negative pinches, positive bulges; `setIntensity` scales magnitude while preserving the sign so a pinch fades flat → pinch (not flat → bulge → pinch). `bulgePinch.center` is normalized 0..1 screen coords (`{ x: 0.5, y: 0.5 }` is the host's middle).

`setIntensity` is the canonical "how strong is this effect right now" dial — fades, gameplay-driven scaling (HP-linked tinting), and looping animation (heartbeat glow, breathing vignette) all go through it. The `set*` setters that change a preset's "full" value (`bloom.setBloomScale`, `glow.setOuterStrength`, `outline.setThickness`, `dropShadow.setAlpha`, `vignette.setStrength`, `chromaticAberration.setSeparation`, `pixelate.setSize`, `glow.setInnerStrength`, `godRay.setGain`, `motionBlur.setVelocity`, `bulgePinch.setStrength`, `halftone.setAmount`, `wave.setAmplitude`) preserve the current intensity ratio — adjusting the ceiling mid-pulse raises the pulse height instead of snapping the visible effect back to 1.

## Scope rationale

Three presets read best at scene scope (or higher) rather than on a single component:

- `godRay` — its alpha-aware fragment shader treats fully transparent host pixels as black, so on a per-component sprite the rays render against a black box; at scene scope the layer rasterizes alpha=1 across the visible area and the rays blend into the world as intended.
- `bulgePinch` — distortion samples outside the host's bounding rect, so a sprite-scoped bulge clips at the sprite edges. Apply at scene/layer scope so the lens has room to bend pixels around its `radius`.
- `shockwave` — the ring expands outward from `center` and is naturally clipped at the host's bounds, so a component-scoped shockwave on a small sprite reads as a tiny "bump" rather than a ring. Scene scope makes `trigger(heroX, heroY)` line up with the entity's transform.

The `examples/src/effects-showcase.ts` demo wires each of these at the recommended scope — copy that as the worked-out reference.

## Per-preset handle extras

```ts
const flash = sprite.fx.addEffect(hitFlash({ color: 0xffffff }));
flash.trigger();              // one-shot ramp up + down
flash.setColor(0xff0000);

const out = sprite.fx.addEffect(outline({ thickness: 3 }));
out.setThickness(5);
out.setColor(0x00ff00);

const bloomH = layer.fx.addEffect(bloom({}));
bloomH.setThreshold(0.6);
bloomH.setBloomScale(2);

const drop = sprite.fx.addEffect(dropShadow({ offset: { x: 4, y: 4 } }));
drop.setOffset(8, 8);
drop.setColor(0x222222);
drop.setAlpha(0.7);

const px = layer.fx.addEffect(pixelate({ size: 8 }));
px.setSize(12);

const g = sprite.fx.addEffect(glow({ outerStrength: 2 }));
g.setOuterStrength(4);
g.setInnerStrength(1);
g.setColor(0xff8800);

tree.fx.addEffect(crt({}));   // noise self-animates; no caller wiring

const ca = layer.fx.addEffect(chromaticAberration({ separation: 4 }));
ca.setSeparation(8);

const vig = renderer.fx.addEffect(vignette({ alpha: 0.5 }));
vig.setStrength(0.8);

const grade = tree.fx.addEffect(colorGrade({ preset: "neutral" }));
grade.setPreset("sepia");

const ray = scene.fx.addEffect(godRay({ angle: 30, gain: 0.5 }));
ray.setAngle(45);            // tweak ray angle in degrees
ray.setGain(0.8);            // rebases full strength; preserves intensity ratio

const sw = scene.fx.addEffect(shockwave({ speed: 600, amplitude: 40 }));
// `center` is in pixels of the filter's input texture, which Pixi sizes
// in canvas pixels (post fit transform on _worldRoot) — NOT virtual
// pixels. Convert before triggering or the ripple drifts off-target the
// moment `fit` scales the canvas (narrow viewport, mobile, etc.):
const sx = renderer.canvasSize.width / renderer.virtualSize.width;
const sy = renderer.canvasSize.height / renderer.virtualSize.height;
sw.trigger(heroX * sx, heroY * sy);
// Re-trigger cancels any in-flight ramp.

const mb = sprite.fx.addEffect(motionBlur({ velocity: { x: 30, y: 0 } }));
mb.setVelocity(50, 12);      // rebases full vector; preserves intensity ratio

scene.fx.addEffect(oldFilm({ sepia: 0.4, noise: 0.4 }));
                             // noise self-animates; only the base
                             // EffectHandle surface is exposed

const bp = scene.fx.addEffect(bulgePinch({ strength: 1, radius: 200 }));
bp.setStrength(-0.8);        // flips bulge → pinch; intensity ratio preserved
bp.setCenter(0.5, 0.5);      // normalized screen coords
bp.setRadius(300);           // distortion radius in pixels

const ht = layer.fx.addEffect(halftone({ size: 6, angle: Math.PI / 4 }));
ht.setSize(10);
ht.setAngle(0);
ht.setAmount(0.7);           // rebases full ceiling; preserves intensity ratio

const wv = layer.fx.addEffect(wave({ amplitude: 6, wavelength: 40 }));
wv.setAmplitude(12);         // rebases full amplitude; preserves intensity ratio
wv.setWavelength(60);        // clamped to ≥ 1
wv.setSpeed(2);              // cycles/second; advances `uTime` from scene time
```

## Fade behavior

Every preset's `fadeIn` / `fadeOut` tweens its primary intensity (column 4 in the table above). For `crt` and `colorGrade` that primary intensity is the filter's overall `alpha`, so fades touch the whole effect rather than a single uniform; for `glow` it scales outer + inner halos in lockstep.

If you need to drive a non-primary uniform (or any custom fade shape), schedule it via `handle.run(p)` — the process is bound to the effect's lifetime and auto-cancels on `.remove()`:

```ts
import { Tween } from "@yagejs/core";

const h = sprite.fx.addEffect(bloom({ bloomScale: 1.5 }));
h.run(Tween.custom((v) => h.someExtra(v), 1, 0, 500));   // pauses with scene, dies with effect
```

For work that should outlive a single effect (e.g. a global animator), schedule directly on the matching scope's queue and manage cancellation yourself:

```ts
import { ProcessComponent, ProcessSystemKey } from "@yagejs/core";

const pc = entity.tryGet(ProcessComponent) ?? entity.add(new ProcessComponent());
pc.run(Tween.custom(...));   // entity-scoped, NOT bound to any one effect
```

## Save/load

All seventeen presets register a stable `yage:<name>` string with `defineEffect`, so any `EffectStack` they're added to round-trips through `SaveService.saveSnapshot` / `loadSnapshot` — the snapshot records the preset's name + options + steady-state intensity + enabled flag, and on load the preset's factory is re-invoked to rebuild the filter. In-flight fades and one-shot ramps (`hitFlash.trigger()`, `shockwave.trigger()`) are not preserved.
