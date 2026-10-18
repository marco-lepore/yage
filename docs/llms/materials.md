# Sprite materials

`@yagejs/renderer` exports `litMaterial`, `unlitMaterial`, `dataTexture`,
`SpriteMaps`, `SpriteMaterial`, `LitMaterial`, `UnlitMaterial`, their option types,
and `DataTextureHandle`. `@yagejs/lighting` exports `surfaceLighting()`.

```ts
import type {
  ColorValue,
  DataTextureHandle,
  TextureRef,
} from "@yagejs/renderer";

interface SpriteMaps {
  readonly normal?: DataTextureHandle;
  readonly specular?: DataTextureHandle;
  readonly emission?: TextureRef;
}
interface UnlitMaterialOptions {
  emissionColor?: ColorValue; // white
  emissionIntensity?: number; // 0..1, default 0
}
interface LitMaterialOptions extends UnlitMaterialOptions {
  normalStrength?: number; // 0..4, default 1; 0 is flat
  normalY?: "up" | "down"; // default "up", OpenGL convention
  specularColor?: ColorValue; // white
  specularStrength?: number; // 0..1, default 0
  shininess?: number; // 1..256, default 32
}
```

Factories return frozen readonly definitions with `kind: "lit" | "unlit"`.
Colors become numeric RGB; all numeric settings must be finite. Share definitions
freely. `SpriteComponent` and `AnimatedSpriteComponent` expose `material`, `maps`,
and `setMaterial(material: SpriteMaterial): void`. Replacement changes one component.

## Complete setup

```ts
import { Engine, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  SpriteComponent,
  dataTexture,
  litMaterial,
  texture,
} from "@yagejs/renderer";
import { LightSource, LightingPlugin, surfaceLighting } from "@yagejs/lighting";

const color = texture("/assets/orb.png");
const normal = dataTexture("/assets/orb.normal.png");
const polished = litMaterial({ specularStrength: 0.5 });
class Orb extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(320, 180) }));
    this.add(
      new SpriteComponent({
        texture: color,
        maps: { normal },
        material: polished,
      }),
    );
  }
}
class Lamp extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(280, 140) }));
    this.add(new LightSource({ radius: 240, height: 64 }));
  }
}
class MaterialScene extends Scene {
  readonly name = "materials";
  readonly preload = [color, normal];
  onEnter(): void {
    this.spawn(Orb);
    this.spawn(Lamp);
  }
}
async function main(): Promise<void> {
  const engine = new Engine();
  engine.use(
    new RendererPlugin({ width: 640, height: 360, container: document.body }),
  );
  engine.use(
    new LightingPlugin({
      ambient: { level: 0.15 },
      renderers: { surface: surfaceLighting() },
      defaultRenderer: "surface",
    }),
  );
  await engine.start();
  await engine.scenes.push(new MaterialScene());
}
void main();
```

The two asset paths represent game-owned images of equal size. Preload every
companion explicitly. `dataTexture(path, { scaleMode?: "nearest" | "linear" })`
accepts lossless PNG, disables color conversion and premultiplication, and preserves
numeric RGB even where alpha is zero. It follows `pixelArtPreset` when scaleMode
is omitted. Color/data imports of one URL have separate cache identity and lifetime.
Scene preload owns images; components release only their own frame views.

## Sources and playback

- `SpriteComponentOptions`: `texture`, optional `maps`, optional `material`.
- `SpriteComponent.setTexture(texture: TextureRef, maps?: SpriteMaps): void`.
- `AnimatedSpriteComponentOptions`: `source`, optional `material`. Maps belong
  inside `SheetFrameSource` or `AtlasFrameSource`.
- `AnimatedSpriteComponent.setSource(source: FrameSource): void` validates,
  installs maps and frames together, stops at frame zero, and clears onComplete.
  Speed, loop, anchor, visual settings, and frame listeners remain.
- Both replacement methods replace the whole map set; omitted maps clear it.
- `AnimationController` and `LayeredAnimationController` install the matching maps
  on every source transition. Playback still uses the component's engine clock.
- Mapped sources require aligned full-page companions with equal pixel dimensions
  and resolution. One page per mapped animation. Grid, trim, and atlas packing
  rotation use the color frame's UVs. Independent map packing is unsupported.
- For atlas frames, preload `spritesheet("/assets/hero.json")` and map handles;
  use `{ atlas: "/assets/hero.json", animation: "walk", maps: { normal } }`.
- The real public `sprite`/`animatedSprite` objects remain. Raw texture writes to
  another page while maps are attached throw; use component methods/controllers.

## Shading and composition

Missing material means ordinary unlit drawing. Missing normal means `(0,0,1)`.
Normal RGB decodes XYZ from `0..1` to `-1..1`; `normalY: "up"` reverses green for
screen coordinates. Inverse-transpose visual transforms handle mirroring,
rotation, and nonuniform scale; cameras do not rotate world lighting.

Specular is Blinn–Phong with fixed viewer direction `(0,0,1)`. The map's red
channel multiplies `specularStrength`; without a map, strength is uniform.
Emission RGB multiplies `emissionColor * emissionIntensity`, independent of light
and shadows. A map alone enables neither contribution: their strengths default to 0.
Export emission images opaque with black for non-emitting pixels; ordinary color
loading can discard RGB at zero alpha.

Existing tint/alpha/blendMode/masks/effects apply to the shaded sprite. Alpha fades
all contributions together. Map alpha does not define coverage. Emission does not
change `levelAt()` or illuminate neighbors; add a LightSource for that. Existing
bloom reads the shaded image and can also affect non-emissive highlights.
Standard color range clamps to 0..1. No HDR, PBR, refraction, transmission, or
per-pixel/colored transparent shadows. Occluders remain opaque geometry.

`LightSourceOptions.height` / `light.height`: positive pixels, default 64, finite
and representable as a positive GPU float. Affects direction only; it does not
change radius falloff, queries, occlusion, draw order, or Transform.

## Backend and cost

`surfaceLighting()` takes no options. Select it through LightingPlugin.renderers
or the existing scene lighting.renderer name. WebGL2/WebGPU required. Bounce
must be null/omitted. Lit sprites require world-space layers. Explicit materials
or maps reject overlay/shader compositor scenes. Unlit materials work without
lighting or with a null backend; lit materials require surfaceLighting.

Graphics, text, UI, particles, and tilemaps do not receive surface lighting.
Adjacent sprites with matching material settings, image pages, lighting provider,
and blend mode share a draw. Sorting, masks, filters, and other visuals keep their
draw boundaries; different tint, alpha, frames, and transforms can share a draw.
Every active light is evaluated, rejecting pixels outside its radius before
shadow work. Point lights use segment intersections; finite lamps retain soft
shadow coverage. Cost grows with lights, occluders, and overdraw.
The Inspector render facet reports material, map paths, source page
label, frame rectangle/packing rotation, animation frame index, and provider.
