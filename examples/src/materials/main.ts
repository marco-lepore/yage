import {
  Component,
  Engine,
  Entity,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  AnimationController,
  GraphicsComponent,
  RendererPlugin,
  SpriteComponent,
  TextComponent,
  dataTexture,
  litMaterial,
  texture,
  unlitMaterial,
} from "@yagejs/renderer";
import type { SpriteMaterial, TextureRef } from "@yagejs/renderer";
import { LightSource, LightingPlugin, surfaceLighting } from "@yagejs/lighting";
import { bloom } from "@yagejs/effects";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const images = {
  color: texture("/assets/materials/orb-color.png"),
  specularColor: texture("/assets/materials/orb-specular-color.png"),
  normal: dataTexture("/assets/materials/orb-normal.png"),
  specular: dataTexture("/assets/materials/orb-specular.png"),
  emission: texture("/assets/materials/orb-emission.png"),
  sheet: texture("/assets/materials/orb-color-sheet.png"),
  normalSheet: dataTexture("/assets/materials/orb-normal-sheet.png"),
  emissionSheet: texture("/assets/materials/orb-emission-sheet.png"),
};
const polished = litMaterial({ specularStrength: 0.65, shininess: 48 });

class Orbit extends Component {
  private readonly transform = this.sibling(Transform);
  private elapsed = 0;
  update(dt: number): void {
    this.elapsed += dt;
    this.transform.setPosition(
      400 + Math.cos(this.elapsed * 0.8) * 260,
      230 + Math.sin(this.elapsed * 1.1) * 160,
    );
  }
}
class Orb extends Entity {
  setup(params: {
    x: number;
    y: number;
    label: string;
    material: SpriteMaterial;
    texture?: TextureRef;
    normal?: boolean;
    specular?: boolean;
    alpha?: number;
    glow?: boolean;
  }): void {
    this.add(
      new Transform({
        position: new Vec2(params.x, params.y),
        scale: new Vec2(2, 2),
      }),
    );
    const sprite = this.add(
      new SpriteComponent({
        texture: params.texture ?? images.color,
        maps: {
          ...(params.normal === false ? {} : { normal: images.normal }),
          ...(params.specular ? { specular: images.specular } : {}),
          emission: images.emission,
        },
        material: params.material,
        anchor: { x: 0.5, y: 0.5 },
        alpha: params.alpha ?? 1,
      }),
    );
    if (params.glow)
      sprite.fx.addEffect(
        bloom({ threshold: 0.6, bloomScale: 1.3, blur: 5, quality: 8 }),
      );
    const label = this.spawnChild("label");
    label.add(
      new Transform({ position: new Vec2(0, 45), scale: new Vec2(0.5, 0.5) }),
    );
    label.add(
      new TextComponent({
        text: params.label,
        anchor: { x: 0.5, y: 0 },
        style: { fontSize: 16, fill: 0xcbd8e5 },
      }),
    );
  }
}
class AnimatedOrb extends Entity {
  setup(): void {
    this.add(
      new Transform({ position: new Vec2(650, 330), scale: new Vec2(2, 2) }),
    );
    const source = {
      sheet: images.sheet,
      frameWidth: 64,
      count: 2,
      maps: { normal: images.normalSheet, emission: images.emissionSheet },
    };
    this.add(
      new AnimatedSpriteComponent({
        source,
        material: litMaterial({ ...polished, emissionIntensity: 0.8 }),
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.add(new AnimationController({ pulse: { source, speed: 0.03 } }));
    const label = this.spawnChild("label");
    label.add(
      new Transform({ position: new Vec2(0, 45), scale: new Vec2(0.5, 0.5) }),
    );
    label.add(
      new TextComponent({
        text: "Animated maps",
        anchor: { x: 0.5, y: 0 },
        style: { fontSize: 16, fill: 0xcbd8e5 },
      }),
    );
  }
}
class Lamp extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(new LightSource({ radius: 550, height: 100, color: 0xffe0b0 }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 5).fill(0xffe0b0);
      }),
    );
    this.add(new Orbit());
  }
}
class MaterialsScene extends Scene {
  readonly name = "materials";
  readonly preload = Object.values(images);
  onEnter(): void {
    this.spawn(Orb, {
      x: 150,
      y: 130,
      label: "Flat",
      material: litMaterial(),
      normal: false,
    });
    this.spawn(Orb, {
      x: 400,
      y: 130,
      label: "Normal map",
      material: litMaterial(),
    });
    this.spawn(Orb, {
      x: 650,
      y: 130,
      label: "Specular map",
      texture: images.specularColor,
      specular: true,
      material: polished,
    });
    this.spawn(Orb, {
      x: 150,
      y: 330,
      label: "Unlit",
      material: unlitMaterial(),
    });
    this.spawn(Orb, {
      x: 370,
      y: 320,
      label: "Emission + bloom",
      material: litMaterial({ emissionIntensity: 0.9 }),
      glow: true,
    });
    this.spawn(Orb, {
      x: 420,
      y: 350,
      label: "Alpha 0.5",
      material: polished,
      alpha: 0.5,
    });
    this.spawn(AnimatedOrb);
    this.spawn(Lamp);
  }
}
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: 800,
      height: 480,
      container: setupGameContainer(800, 480),
      backgroundColor: 0x111c2b,
    }),
  );
  engine.use(
    new LightingPlugin({
      ambient: { level: 0.12 },
      renderers: { surface: surfaceLighting() },
      defaultRenderer: "surface",
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new MaterialsScene());
}
main().catch(console.error);
