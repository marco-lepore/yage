import {
  AssetManagerKey,
  SceneManagerKey,
  Component,
  Engine,
  Entity,
  InspectorKey,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  CameraEntity,
  SceneRenderTreeKey,
  AnimatedSpriteComponent,
  GraphicsComponent,
  RendererKey,
  RendererPlugin,
  SpriteComponent,
  spritesheet,
  dataTexture,
  litMaterial,
  texture,
  unlitMaterial,
  graphicsMask,
  rawFilter,
} from "@yagejs/renderer";
import {
  LightOccluder,
  LightingWorldKey,
  LightSource,
  LightingPlugin,
  surfaceLighting,
} from "@yagejs/lighting";
import { DebugPlugin } from "@yagejs/debug";
import { ColorMatrixFilter, Sprite, AnimatedSprite } from "pixi.js";
import { setupContainer } from "./shared.js";

const images = {
  atlas: spritesheet("/material-assets/atlas.json"),
  gray: texture("/material-assets/gray.png"),
  red: texture("/material-assets/red.png"),
  left: dataTexture("/material-assets/left.png"),
  right: dataTexture("/material-assets/right.png"),
  up: dataTexture("/material-assets/up.png"),
  specular: dataTexture("/material-assets/specular.png"),
  atlasNormal: dataTexture("/material-assets/atlas-normal.png"),
  sheet: texture("/material-assets/sheet.png"),
  sheetNormal: dataTexture("/material-assets/sheet-normal.png"),
};

class MaterialProbe extends Component {
  readonly left: SpriteComponent;
  readonly right: SpriteComponent;
  readonly animated: AnimatedSpriteComponent;
  readonly light: LightSource;
  camera: CameraEntity | undefined;
  plain: SpriteComponent | undefined;

  constructor(
    left: SpriteComponent,
    right: SpriteComponent,
    animated: AnimatedSpriteComponent,
    light: LightSource,
  ) {
    super();
    this.left = left;
    this.right = right;
    this.animated = animated;
    this.light = light;
  }

  onAdd(): void {
    const renderer = this.use(RendererKey);
    const inspector = this.use(InspectorKey);
    this.addCleanup(() => inspector.removeExtension("materials"));
    inspector.addExtension("materials", {
      assets: async () => {
        const assets = this.use(AssetManagerKey);
        const path = "/material-assets/gray.png?identity";
        const color = texture(path);
        const numeric = dataTexture(path);
        await assets.loadAll([color, numeric]);
        await assets.loadAll([numeric]);
        const a = assets.get(color);
        const b = assets.get(numeric);
        const independent = a.source !== b.source;
        await assets.unload(numeric);
        const retained = !b.destroyed && assets.has(numeric);
        await assets.unload(color);
        const isolated = a.destroyed && !b.destroyed;
        await assets.unload(numeric);
        return { independent, retained, isolated, released: b.destroyed };
      },
      replaceScene: () =>
        this.use(SceneManagerKey).replace(new MaterialScene()),
      pushScene: () => this.use(SceneManagerKey).push(new UpperScene()),
      popScene: () => this.use(SceneManagerKey).pop(),
      backend: () => renderer.application.renderer.name,
      pixel: (x: number, y: number) => {
        const captured = renderer.captureCanvas();
        if (!(captured instanceof HTMLCanvasElement))
          throw new Error(
            "Material probe: browser canvas extraction required.",
          );
        const copy = document.createElement("canvas");
        copy.width = captured.width;
        copy.height = captured.height;
        const ctx = copy.getContext("2d")!;
        ctx.drawImage(captured, 0, 0);
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      },
      realSprites: () => [
        this.left.renderObject instanceof Sprite,
        this.animated.renderObject instanceof AnimatedSprite,
      ],
      atlas: () =>
        this.animated.setSource({
          atlas: images.atlas.path,
          animation: "idle",
          maps: { normal: images.atlasNormal },
        }),
      clearMaps: () =>
        this.animated.setSource({
          sheet: images.sheet,
          frameWidth: 32,
          count: 2,
        }),
      frame: (frame: number) => this.animated.gotoFrame(frame),

      darkness: () => {
        this.light.intensity = 0;
      },
      emission: () =>
        this.left.setMaterial(
          litMaterial({ emissionColor: 0xff0000, emissionIntensity: 0.5 }),
        ),
      specular: () =>
        this.left.setMaterial(
          litMaterial({ normalStrength: 0, specularStrength: 1, shininess: 4 }),
        ),
      specularMap: () => {
        this.left.setTexture(images.gray, { specular: images.specular });
        this.left.setMaterial(
          litMaterial({ specularStrength: 1, shininess: 4 }),
        );
      },
      normalY: (normalY: "up" | "down") => {
        this.left.setTexture(images.gray, { normal: images.up });
        this.left.setMaterial(litMaterial({ normalY }));
        this.light.entity.get(Transform).setPosition(48, 8);
      },
      alpha: (alpha: number) => {
        this.left.alpha = alpha;
      },
      mirror: () => {
        this.left.entity.get(Transform).setPosition(64, 32);
        this.left.entity.get(Transform).setScale(-1, 1);
      },
      rotate: () => {
        this.left.entity.get(Transform).setPosition(64, 64);
        this.left.modifiers.addTransform({ rotation: Math.PI });
      },
      hide: () => {
        this.left.enabled = false;
      },
      show: () => {
        this.left.enabled = true;
      },
      scale: (x: number, y: number) => {
        this.left.entity.get(Transform).setScale(x, y);
      },
      camera: () => {
        this.camera = this.scene.spawn(CameraEntity, {
          position: new Vec2(100, 60),
          zoom: 1.4,
        });
        this.camera.rotation = 0.3;
      },
      screen: (x: number, y: number) =>
        this.camera?.worldToScreen(x, y) ?? { x, y },
      shadow: () => {
        const wall = this.scene.spawn("wall");
        wall.add(new Transform({ position: new Vec2(76, 48) }));
        wall.add(
          new LightOccluder({ shape: { type: "box", width: 8, height: 64 } }),
        );
      },
      pointBlocker: (shape: "box" | "circle", x: number, y: number) => {
        const wall = this.scene.spawn("point-blocker");
        wall.add(new Transform({ position: new Vec2(x, y) }));
        wall.add(
          new LightOccluder({
            shape:
              shape === "box"
                ? { type: "box", width: 16, height: 16 }
                : { type: "circle", radius: 8 },
          }),
        );
      },
      level: () => this.use(LightingWorldKey).levelAt(48, 48),
      cone: () => {
        this.light.coneAngle = Math.PI / 2;
      },
      flat: () => this.left.setMaterial(litMaterial({ normalStrength: 0 })),
      height: (height: number) => {
        this.light.height = height;
      },
      tint: () => {
        this.left.tint = 0xff0000;
      },
      additive: () => {
        this.left.blendMode = "add";
        // A screen-space layer keeps this sprite on Pixi's own sprite pipe.
        const reference = this.scene.spawn("ordinary-additive-reference");
        reference.add(new Transform({ position: new Vec2(32, 80) }));
        reference.add(
          new SpriteComponent({
            texture: images.gray,
            layer: "native",
            tint: 0xff0000,
            alpha: 0.5,
            blendMode: "add",
          }),
        );
      },
      plain: () => {
        const plain = this.scene.spawn("plain");
        plain.add(new Transform({ position: new Vec2(112, 80) }));
        this.plain = plain.add(new SpriteComponent({ texture: images.gray }));
      },
      plainUnlit: () => this.plain?.setMaterial(unlitMaterial()),
      reverseOrder: () => {
        this.left.zIndex = 1;
      },
      aboveEffects: () => {
        const filter = new ColorMatrixFilter();
        filter.brightness(0, false);
        this.use(SceneRenderTreeKey).fx.addEffect(rawFilter(filter));
        this.left.renderAboveEffects = true;
      },
      emissionMap: () => {
        this.left.setTexture(images.gray, { emission: images.red });
        this.left.setMaterial(litMaterial({ emissionIntensity: 0.5 }));
      },
      layerFilter: () =>
        this.use(SceneRenderTreeKey).defaultLayer.fx.addEffect(
          rawFilter(new ColorMatrixFilter()),
        ),
      sceneFilter: () =>
        this.use(SceneRenderTreeKey).fx.addEffect(
          rawFilter(new ColorMatrixFilter()),
        ),
      overlap: () => {
        this.right.entity.get(Transform).setPosition(32, 32);
        this.right.alpha = 0.5;
      },
      unlit: () => this.left.setMaterial(unlitMaterial()),
      mask: () =>
        this.left.setMask(
          graphicsMask((g) => {
            g.rect(0, 0, 16, 32).fill(0xffffff);
          }),
        ),
      filter: () => this.left.fx.addEffect(rawFilter(new ColorMatrixFilter())),
      batch: () => {
        this.right.setTexture(images.gray, { normal: images.right });
        this.right.entity.get(Transform).setPosition(72, 40);
        this.right.entity.get(Transform).setScale(-1, 1.5);
        this.right.tint = 0x66ffcc;
        this.right.alpha = 0.5;
      },
      separateBatch: () =>
        this.right.fx.addEffect(rawFilter(new ColorMatrixFilter())),
      replaceBatchMaterial: () =>
        this.right.setMaterial(unlitMaterial({ emissionIntensity: 0.2 })),
    });
  }
}

class TestSprite extends Entity {
  setup(params: { x: number; normal: "left" | "right" }): void {
    this.add(new Transform({ position: new Vec2(params.x, 32) }));
    this.add(
      new SpriteComponent({
        texture: images.gray,
        maps: { normal: images[params.normal] },
        material: litMaterial(),
      }),
    );
  }
}
class TestAnimation extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(160, 32) }));
    this.add(
      new AnimatedSpriteComponent({
        source: {
          sheet: images.sheet,
          frameWidth: 32,
          count: 2,
          maps: { normal: images.sheetNormal },
        },
        material: litMaterial(),
      }),
    );
  }
}
class TestLamp extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(96, 48) }));
    this.add(new LightSource({ radius: 200, height: 32 }));
  }
}
class MaterialScene extends Scene {
  readonly name = "materials";
  readonly preload = Object.values(images);
  readonly layers = [{ name: "native", order: 1, space: "screen" as const }];
  onEnter(): void {
    const background = this.spawn("background");
    background.add(new Transform());
    background.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, 256, 128).fill(0);
      }),
    );
    const left = this.spawn(TestSprite, { x: 32, normal: "right" }).get(
      SpriteComponent,
    );
    const right = this.spawn(TestSprite, { x: 112, normal: "left" }).get(
      SpriteComponent,
    );
    const animated = this.spawn(TestAnimation).get(AnimatedSpriteComponent);
    const lamp = this.spawn(TestLamp).get(LightSource);
    this.spawn("probe").add(new MaterialProbe(left, right, animated, lamp));
  }
}
class UpperScene extends Scene {
  readonly name = "upper-materials";
  readonly transparentBelow = true;
  readonly preload = Object.values(images);
  onEnter(): void {
    this.use(LightingWorldKey).setAmbient(1, 0x00ff00);
    const sprite = this.spawn(TestSprite, { x: 32, normal: "left" }).get(
      SpriteComponent,
    );
    sprite.alpha = 0.5;
  }
}
const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: 256,
    height: 128,
    resolution: 1,
    container: setupContainer(256, 128),
    pixelArtPreset: true,
    pixi: {
      preference:
        new URLSearchParams(location.search).get("backend") === "webgpu"
          ? "webgpu"
          : "webgl",
    },
  }),
);
engine.use(
  new LightingPlugin({
    ambient: { level: 0 },
    renderers: { surface: surfaceLighting() },
    defaultRenderer: "surface",
  }),
);
engine.use(new DebugPlugin({ startFrozen: true }));
await engine.start();
await engine.scenes.push(new MaterialScene());
engine.context.resolve(InspectorKey).time.step();
