# @yagejs/effects

Depends on `@yagejs/renderer` (peer), `pixi.js` (peer), `pixi-filters`. Built-in visual-effect presets added via `.fx.addEffect` at any of the four scopes (component / layer / scene / screen). Each preset uses `defineEffect` to provide a named factory with typed options.

## Setup

No plugin install — just import a preset and call it like a factory:

```ts
import { hitFlash, bloom, crt, vignette } from "@yagejs/effects";

sprite.fx.addEffect(hitFlash({ color: 0xffffff }));
tree.get("world").fx.addEffect(bloom({ threshold: 0.8 }));
tree.fx.addEffect(crt({}));
this.use(RendererKey).fx.addEffect(vignette({ alpha: 0.4 }));
```

Each preset returns the same `EffectHandle` shape (`remove`, `setEnabled`, `enabled`, `setIntensity(value)`, `fadeIn(duration)`, `fadeOut(duration)`) plus typed extras specific to the preset (e.g. `OutlineHandle.setThickness(n)`).

## Presets

| Preset                | Options shape                                                                                                              | Wraps                                  | Primary intensity                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `hitFlash`            | `{ color?, duration?, peak? }`                                                                                             | built-in `ColorMatrixFilter`           | additive tint amount                               |
| `bloom`               | `{ threshold?, bloomScale?, brightness?, blur?, quality? }`                                                                | `pixi-filters` `AdvancedBloomFilter`   | `bloomScale`                                       |
| `outline`             | `{ thickness?, color?, alpha?, quality?, knockout? }`                                                                      | `pixi-filters` `OutlineFilter`         | `thickness`                                        |
| `dropShadow`          | `{ offset?, color?, alpha?, blur?, quality?, shadowOnly? }`                                                                | `pixi-filters` `DropShadowFilter`      | `alpha`                                            |
| `pixelate`            | `{ size? }`                                                                                                                | `pixi-filters` `PixelateFilter`        | `size` (clamped to ≥ 1)                            |
| `glow`                | `{ color?, distance?, outerStrength?, innerStrength?, alpha?, quality?, knockout? }`                                       | `pixi-filters` `GlowFilter`            | scales BOTH strengths together                     |
| `crt`                 | `{ curvature?, lineWidth?, lineContrast?, verticalLine?, noise?, vignetting?, vignettingAlpha? }`                          | `pixi-filters` `CRTFilter`             | filter `alpha` (whole effect; noise self-animates) |
| `chromaticAberration` | `{ separation? }`                                                                                                          | `pixi-filters` `RGBSplitFilter`        | symmetric `separation` (red −x, blue +x)           |
| `vignette`            | `{ radius?, alpha?, blur? }`                                                                                               | `CRTFilter` (with CRT features zeroed) | `vignettingAlpha`                                  |
| `colorGrade`          | `{ preset?, amount? }`                                                                                                     | built-in `ColorMatrixFilter`           | filter `alpha` (cross-fades to identity)           |
| `godRay`              | `{ angle?, gain?, lacunarity?, alpha? }`                                                                                   | `pixi-filters` `GodrayFilter`          | `gain` (rays scale 0 → full)                       |
| `shockwave`           | `{ speed?, amplitude?, wavelength?, brightness?, radius?, duration? }`                                                     | `pixi-filters` `ShockwaveFilter`       | `amplitude × brightness` (zero until `trigger`)    |
| `motionBlur`          | `{ velocity?, kernelSize?, offset? }`                                                                                      | `pixi-filters` `MotionBlurFilter`      | configured `velocity` magnitude                    |
| `oldFilm`             | `{ sepia?, noise?, noiseSize?, scratch?, scratchDensity?, scratchWidth?, vignetting?, vignettingAlpha?, vignettingBlur? }` | `pixi-filters` `OldFilmFilter`         | filter `alpha` (whole effect; noise self-animates) |
| `bulgePinch`          | `{ strength?, radius?, center? }`                                                                                          | `pixi-filters` `BulgePinchFilter`      | configured `strength` (sign preserved)             |
| `halftone`            | `{ size?, amount?, angle? }`                                                                                               | custom WebGL+WGSL                      | `amount` (cross-fades back to source)              |
| `wave`                | `{ amplitude?, wavelength?, speed? }`                                                                                      | custom WebGL+WGSL                      | configured `amplitude`                             |
| `colorize`            | `{ color, strength? }`                                                                                                     | custom WebGL+WGSL                      | `strength` (cross-fades back to source)            |
| `glitch`              | `{ slices?, offset?, direction?, fillMode?, average?, minSize?, sampleSize?, red?, green?, blue?, seed? }`                 | `pixi-filters` `GlitchFilter`          | band displacement and RGB offsets                  |
| `zoomBlur`            | `{ strength?, center?, innerRadius?, radius?, expandFromCenter?, maxKernelSize? }`                                         | `pixi-filters` `ZoomBlurFilter`        | signed blur strength                               |
| `axisBlur`            | `{ strength?, axis?, perpendicularStrength?, quality?, kernelSize?, repeatEdgePixels? }`                                   | built-in `BlurFilter`                  | main and perpendicular strengths                   |
| `implosion`           | `{ center?, radius?, strength?, darkness?, swirl?, expandFromCenter? }`                                                    | custom WebGL+WGSL                      | inward pull, darkness, and swirl                   |
| `dissolve`            | `{ edgeColor?, edgeWidth?, noiseScale?, softness?, seed? }`                                                                | custom WebGL+WGSL                      | dissolve progress from intact to transparent       |

All `duration` options and `fadeIn`/`fadeOut` arguments are in seconds (`hitFlash` default 0.12, `shockwave` default 1).

Color-grade presets: `"neutral"` (identity), `"sepia"`, `"grayscale"`, `"negative"`, `"night"`, `"warm"` (orange tint + brightness boost), `"cool"` (blue tint).

`motionBlur.kernelSize` must be odd and ≥ 5. Invalid values are coerced up to the nearest valid kernel and a one-shot `console.warn` fires naming the requested + final value. `bulgePinch.strength` is signed: negative pinches, positive bulges. A fade scales the magnitude while preserving the sign, so a pinch fades flat → pinch, not flat → bulge → pinch. `bulgePinch.center` is normalized 0..1 screen coords (`{ x: 0.5, y: 0.5 }` is the host's middle). `zoomBlur.strength` is also signed: positive values streak outward and negative values pull inward. `axisBlur` is symmetric around each source pixel; use `motionBlur` for a directional trailing smear.

`zoomBlur.expandFromCenter` grows a finite `radius` outward with intensity. A
negative, unlimited radius cannot expand. `implosion.expandFromCenter` applies
the same center-first progression to its pull, darkness, and swirl.

`glitch`, `zoomBlur`, `axisBlur`, `implosion`, and `dissolve` reject a
non-finite or out-of-range number at the call that supplies it — options,
`setIntensity`, and the per-preset setters alike — and throw naming the input
and the constraint (`implosion: radius must be >= 1, got 0.`). A `NaN` written
into a filter uniform renders undefined output with nothing pointing back at
its source, so these throw instead of clamping. Range-bound inputs:
`implosion.radius` ≥ 1, `implosion.darkness` 0–1, `zoomBlur.innerRadius` ≥ 0,
`glitch.slices` and `glitch.sampleSize` integers ≥ 1, `axisBlur.quality` an
integer ≥ 1, `dissolve.edgeWidth` 0.001–0.5, `dissolve.noiseScale` ≥ 1,
`dissolve.softness` 0.001–0.25.

The public handle controls an effect's strength three ways. `setIntensity(value)` sets the primary intensity immediately and clamps the value to 0–1. `fadeIn(seconds)` and `fadeOut(seconds)` tween that same value and return a `Process`. The per-preset `set*` setters that change a preset's "full" value (`bloom.setBloomScale`, `glow.setOuterStrength`, `outline.setThickness`, `dropShadow.setAlpha`, `vignette.setStrength`, `chromaticAberration.setSeparation`, `pixelate.setSize`, `glow.setInnerStrength`, `godRay.setGain`, `motionBlur.setVelocity`, `bulgePinch.setStrength`, `halftone.setAmount`, `wave.setAmplitude`, `colorize.setStrength`) rebase that ceiling while preserving the current intensity ratio. For example, `bloom.setIntensity(0.5)` displays half of the configured bloom scale, while `bloom.setBloomScale(2)` changes what full strength means. For a custom timed animation, pass a tween to `run`; the process is scoped to the effect and stops on `.remove()`.

## Scope rationale

Three presets work best at scene scope (or higher) rather than on a single component:

- `godRay` — its alpha-aware fragment shader treats fully transparent host pixels as black, so on a per-component sprite the rays render against a black box. At scene scope, the layer rasterizes alpha=1 across the visible area, and the rays blend into the world as intended.
- `bulgePinch` — distortion samples outside the host's bounding rect, so a sprite-scoped bulge clips at the sprite edges. Apply at scene/layer scope so the lens has room to bend pixels around its `radius`.
- `shockwave` — the ring expands outward from `center` and is naturally clipped at the host's bounds, so a component-scoped shockwave on a small sprite looks like a tiny "bump" rather than a ring. Scene scope makes `trigger(heroX, heroY)` line up with the entity's transform.

The `examples/src/effects-showcase/main.ts` demo sets up each of these at the recommended scope — copy that as the worked-out reference.

Scene scope and screen scope also post-process the UI. `@yagejs/ui` mounts its screen-space `"ui"` layer inside the scene's render tree, so `tree.fx.addEffect(...)` (scene scope) and a renderer-level effect (screen scope) both filter the HUD along with the world. To keep an effect off the HUD, attach it at the content layer instead — `tree.get("world").fx.addEffect(...)` (layer scope, per the Setup examples) — so only that layer is filtered.

## Unit reference (and a known limitation)

Pixel-valued options on older presets and `axisBlur` are in **input-texture pixels** — i.e. the rasterized region's pixel size, post fit + camera transforms. With responsive `fit`, that means a `bloom.blur: 8` is 8/900 = 0.89% of canvas width on a desktop-native viewport but 8/382 = 2.10% on a mobile-sized one. Effects visibly "scale up" on smaller canvases. This is a known cross-package issue, not specific to any one preset.

Six presets ship with built-in resolution-stability:

- `bulgePinch.center` is normalized 0..1 (resolution-independent by construction).
- `shockwave` accepts container-local coords for `trigger(x, y)` AND for every dimensional option, and converts each frame against the filter target's live `worldTransform`. **This is experimental** — don't depend on `shockwave`'s exact unit behavior across versions.
- `glitch` interprets band displacement and RGB offsets in host-local pixels.
- `zoomBlur` interprets its center and radii in host-local pixels.
- `implosion` interprets its center and radius in host-local pixels.
  `expandFromCenter: true` grows the affected radius outward as intensity rises.
- `dissolve` interprets its noise scale in host-local pixels.

If you need resolution-stable visual output today on the other presets, scale your option values by `renderer.canvasSize.width / renderer.virtualSize.width` at the call site.

## Per-preset handle extras

```ts
const flash = sprite.fx.addEffect(hitFlash({ color: 0xffffff }));
flash.trigger(); // one-shot ramp up + down
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

tree.fx.addEffect(crt({})); // noise self-animates; no caller setup

const ca = layer.fx.addEffect(chromaticAberration({ separation: 4 }));
ca.setSeparation(8);

const vig = renderer.fx.addEffect(vignette({ alpha: 0.5 }));
vig.setStrength(0.8);

const grade = tree.fx.addEffect(colorGrade({ preset: "neutral" }));
grade.setPreset("sepia");

const ray = scene.fx.addEffect(godRay({ angle: 30, gain: 0.5 }));
ray.setAngle(45); // tweak ray angle in degrees
ray.setGain(0.8); // rebases full strength; preserves intensity ratio

const sw = scene.fx.addEffect(shockwave({ speed: 600, amplitude: 40 }));
sw.trigger(heroX, heroY); // ALL pixel-valued inputs (center, amplitude,
// wavelength, radius, speed) are in the filter
// target's local space — virtual px for
// scene/layer scope, sprite-local for
// component scope. The wrapper rescales them
// to input-texture px every frame from the
// target's live worldTransform, so resize /
// camera zoom / scope changes preserve both
// the trigger point AND the visual ring shape
// / travel speed at any size.
// Re-trigger cancels any in-flight ramp.

const mb = sprite.fx.addEffect(motionBlur({ velocity: { x: 30, y: 0 } }));
mb.setVelocity(50, 12); // rebases full vector; preserves intensity ratio

scene.fx.addEffect(oldFilm({ sepia: 0.4, noise: 0.4 }));
// noise self-animates; only the base
// EffectHandle surface is exposed

const bp = scene.fx.addEffect(bulgePinch({ strength: 1, radius: 200 }));
bp.setStrength(-0.8); // flips bulge → pinch; intensity ratio preserved
bp.setCenter(0.5, 0.5); // normalized screen coords
bp.setRadius(300); // distortion radius in pixels

const ht = layer.fx.addEffect(halftone({ size: 6, angle: Math.PI / 4 }));
ht.setSize(10);
ht.setAngle(0);
ht.setAmount(0.7); // rebases full ceiling; preserves intensity ratio

const wv = layer.fx.addEffect(wave({ amplitude: 6, wavelength: 40 }));
wv.setAmplitude(12); // rebases full amplitude; preserves intensity ratio
wv.setWavelength(60); // clamped to ≥ 1
wv.setSpeed(2); // cycles/second; advances `uTime` from scene time

// Recolour a sprite without the multiply-tint trap — black stays black,
// white reaches the target colour, midtones blend proportionally, and
// source alpha is preserved unchanged.
const recolour = sprite.fx.addEffect(colorize({ color: 0xf2c14e }));
recolour.setColor(0xd94a4a); // accepts numbers or strings ("#d94a4a", "red")
recolour.setStrength(0.6); // rebases full ceiling; preserves intensity ratio
recolour.fadeOut(0.2); // strength → 0 cross-fades back to the source (seconds)
const glitchH = sprite.fx.addEffect(glitch({ slices: 8, offset: 24 }));
glitchH.refresh(42); // deterministic replacement pattern
glitchH.setOffset(36);

const zoom = layer.fx.addEffect(
  zoomBlur({ center: playerPosition, strength: 0.15 }),
);
zoom.setCenter(nextX, nextY); // host-local coordinates
zoom.setStrength(-0.12); // negative pulls inward

const axis = sprite.fx.addEffect(
  axisBlur({ axis: "horizontal", strength: 12 }),
);
axis.setAxis("vertical");
axis.setPerpendicularStrength(2);

const hole = layer.fx.addEffect(
  implosion({ center: playerPosition, radius: 180 }),
);
hole.setDarkness(1);
hole.setSwirl(0.6);

const vanish = sprite.fx.addEffect(
  dissolve({ edgeColor: 0x67e8f9, noiseScale: 10 }),
);
vanish.setIntensity(0.5); // half of the noise field is transparent
vanish.setSeed(7);
```

`dissolve` requires `edgeWidth` from 0.001 to 0.5, `noiseScale` of at
least 1, `softness` from 0.001 to 0.25, and a finite `seed`.

## Fade behavior

Every preset's `fadeIn` / `fadeOut` tweens its primary intensity (column 4 in the table above). For `crt` and `colorGrade` that primary intensity is the filter's overall `alpha`, so fades touch the whole effect rather than a single uniform; for `glow` it scales outer + inner halos in lockstep.

If you need to drive a non-primary uniform (or any custom fade shape), schedule it via `handle.run(p)` — the process is bound to the effect's lifetime and auto-cancels on `.remove()`:

```ts
import { Tween } from "@yagejs/core";

const h = sprite.fx.addEffect(bloom({ bloomScale: 1.5 }));
h.run(Tween.custom((v) => h.someExtra(v), 1, 0, 0.5)); // pauses with scene, ends with effect
```

For work that should outlive a single effect (e.g. a global animator), schedule directly on the matching scope's queue and manage cancellation yourself:

```ts
import { ProcessComponent, ProcessSystemKey } from "@yagejs/core";

const pc = entity.tryGet(ProcessComponent) ?? entity.add(new ProcessComponent());
pc.run(Tween.custom(...));   // entity-scoped, NOT bound to any one effect
```

## Save state

Effects and their processes are runtime resources. Save the durable game fact
that selects an effect, then add it again during normal component or scene
setup after load.
