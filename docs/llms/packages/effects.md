# @yagejs/effects

Depends on `@yagejs/renderer` (peer), `pixi.js` (peer), `pixi-filters`. Built-in visual-effect presets that plug into `addEffect` at any of the four scopes (component / layer / scene / screen). Each preset is registered through `defineEffect`, so attached effects round-trip through `SaveService.saveSnapshot` / `loadSnapshot` automatically.

## Setup

No plugin install — just import a preset and call it like a factory:

```ts
import { hitFlash, bloom, crt, vignette } from "@yagejs/effects";

sprite.addEffect(hitFlash({ color: 0xffffff }));
tree.get("world").addEffect(bloom({ threshold: 0.8 }));
tree.addEffect(crt({}));
this.use(RendererKey).addEffect(vignette({ alpha: 0.4 }));
```

Each preset returns the same `EffectHandle` shape (`remove`, `setEnabled`, `enabled`, `fadeIn(duration)`, `fadeOut(duration)`) plus typed extras specific to the preset (e.g. `OutlineHandle.setThickness(n)`).

## Presets

| Preset | Options shape | Wraps | Primary intensity |
|---|---|---|---|
| `hitFlash` | `{ color?, duration?, peak? }` | built-in `ColorMatrixFilter` | additive tint amount |
| `bloom` | `{ threshold?, bloomScale?, brightness?, blur?, quality? }` | `pixi-filters` `AdvancedBloomFilter` | `bloomScale` |
| `outline` | `{ thickness?, color?, alpha?, quality?, knockout? }` | `pixi-filters` `OutlineFilter` | `thickness` |
| `dropShadow` | `{ offset?, color?, alpha?, blur?, quality?, shadowOnly? }` | `pixi-filters` `DropShadowFilter` | `alpha` |
| `pixelate` | `{ size? }` | `pixi-filters` `PixelateFilter` | `size` |
| `glow` | `{ color?, distance?, outerStrength?, innerStrength?, alpha?, quality?, knockout? }` | `pixi-filters` `GlowFilter` | `outerStrength` |
| `crt` | `{ curvature?, lineWidth?, lineContrast?, verticalLine?, noise?, vignetting?, vignettingAlpha? }` | `pixi-filters` `CRTFilter` | `lineContrast` (call `step(dt)` to animate noise) |
| `chromaticAberration` | `{ separation? }` | `pixi-filters` `RGBSplitFilter` | symmetric `separation` (red −x, blue +x) |
| `vignette` | `{ radius?, alpha?, blur? }` | `CRTFilter` (with CRT features zeroed) | `vignettingAlpha` |
| `colorGrade` | `{ preset?, amount? }` | built-in `ColorMatrixFilter` | filter `alpha` (cross-fades to identity) |

Color-grade presets: `"neutral"` (identity), `"sepia"`, `"grayscale"`, `"negative"`, `"night"`, `"warm"` (orange tint + brightness boost), `"cool"` (blue tint).

## Per-preset handle extras

```ts
const flash = sprite.addEffect(hitFlash({ color: 0xffffff }));
flash.trigger();              // one-shot ramp up + down
flash.setColor(0xff0000);

const out = sprite.addEffect(outline({ thickness: 3 }));
out.setThickness(5);
out.setColor(0x00ff00);

const bloomH = layer.addEffect(bloom({}));
bloomH.setThreshold(0.6);
bloomH.setBloomScale(2);

const drop = sprite.addEffect(dropShadow({ offset: { x: 4, y: 4 } }));
drop.setOffset(8, 8);
drop.setColor(0x222222);
drop.setAlpha(0.7);

const px = layer.addEffect(pixelate({ size: 8 }));
px.setSize(12);

const g = sprite.addEffect(glow({ outerStrength: 2 }));
g.setOuterStrength(4);
g.setInnerStrength(1);
g.setColor(0xff8800);

const tube = scene.addEffect(crt({}));
function update(dt: number) { tube.step(dt); }   // animate noise

const ca = layer.addEffect(chromaticAberration({ separation: 4 }));
ca.setSeparation(8);

const vig = renderer.addEffect(vignette({ alpha: 0.5 }));
vig.setStrength(0.8);

const grade = scene.addEffect(colorGrade({ preset: "neutral" }));
grade.setPreset("sepia");
```

## Fade behavior

Every preset's `fadeIn` / `fadeOut` tweens its primary intensity (column 3 in the table above). Effects without a meaningful linear "intensity" uniform (`crt`, `colorGrade` matrix preset) still fade — they do so via the same `setIntensity` axis (scanline contrast for `crt`, filter alpha for `colorGrade`). For asymmetric needs, wrap with `withFade(...)` from `@yagejs/renderer`.

## Save/load

All ten presets register a stable `yage:<name>` string with `defineEffect`, so any `EffectStack` they're added to round-trips through `SaveService.saveSnapshot` / `loadSnapshot` — the snapshot records the preset's name + options + steady-state intensity + enabled flag, and on load the preset's factory is re-invoked to rebuild the filter. In-flight fades are not preserved.
