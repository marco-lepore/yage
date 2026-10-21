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
import type {
  LayerDef,
  LitMaterialOptions,
  SpriteMaps,
  SpriteMaterial,
  TextureRef,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  LightOccluder,
  LightSource,
  LightingPlugin,
  surfaceLighting,
} from "@yagejs/lighting";
import { bloom } from "@yagejs/effects";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Constants and assets
// ---------------------------------------------------------------------------

const WIDTH = 800;
const HEIGHT = 480;
const TILE = 64;
/** Depth of the strip along the crate's base that blocks light. */
const CRATE_FOOTPRINT = 12;
const HUD_LAYER = "hud";

const MIN_LAMP_HEIGHT = 16;
const MAX_LAMP_HEIGHT = 320;
/** Pixels per second the lamp rises or sinks while a key is held. */
const LAMP_CLIMB = 120;

// Color images load through `texture`; numeric normal and specular maps load
// through `dataTexture`, which keeps their channel values exact.
const images = {
  floor: texture("/assets/materials/floor.png"),
  crate: texture("/assets/materials/crate.png"),
  crateNormal: dataTexture("/assets/materials/crate-normal.png"),
  orb: texture("/assets/materials/orb-color.png"),
  orbNormal: dataTexture("/assets/materials/orb-normal.png"),
  orbEmission: texture("/assets/materials/orb-emission.png"),
  gildedOrb: texture("/assets/materials/orb-specular-color.png"),
  gildedSpecular: dataTexture("/assets/materials/orb-specular.png"),
  orbSheet: texture("/assets/materials/orb-color-sheet.png"),
  orbSheetNormal: dataTexture("/assets/materials/orb-normal-sheet.png"),
  orbSheetEmission: texture("/assets/materials/orb-emission-sheet.png"),
};

/** One set of options, shared by the presets below. */
const POLISHED: LitMaterialOptions = { specularStrength: 0.65, shininess: 48 };
const polished = litMaterial(POLISHED);
const glowing = litMaterial({ emissionIntensity: 0.9 });
const pulsing = litMaterial({ ...POLISHED, emissionIntensity: 0.8 });

const LABEL_STYLE = { fontSize: 16, fill: 0xcbd8e5 };

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Moves the lamp: it follows the pointer once one is over the scene and
 * circles the room until then. The up and down actions raise and lower it.
 */
class LampControl extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly light = this.sibling(LightSource);
  private elapsed = 0;

  update(dt: number): void {
    this.elapsed += dt;
    if (this.input.getPointers().length > 0) {
      const pointer = this.input.getPointerPosition();
      this.transform.setPosition(pointer.x, pointer.y);
    } else {
      this.transform.setPosition(
        WIDTH / 2 + Math.cos(this.elapsed * 0.8) * 300,
        HEIGHT / 2 + Math.sin(this.elapsed * 1.1) * 170,
      );
    }
    const climb = this.input.getAxis("lower", "raise");
    if (climb !== 0) {
      this.light.height = Math.min(
        MAX_LAMP_HEIGHT,
        Math.max(MIN_LAMP_HEIGHT, this.light.height + climb * LAMP_CLIMB * dt),
      );
    }
  }
}

/** Shows the lamp's height on the HUD. */
class LampReadout extends Component {
  private readonly text = this.sibling(TextComponent);

  constructor(private readonly light: LightSource) {
    super();
  }

  update(): void {
    this.text.setText(
      `Lamp height ${Math.round(this.light.height)} px  ·  Up / Down to change`,
    );
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * A floor tile with no maps and no material. In a `surfaceLighting()` scene
 * a sprite on a world layer is lit flat by default.
 */
class FloorTile extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(new SpriteComponent({ texture: images.floor }));
  }
}

/** A caption under a scaled sprite. Text is never lit. */
class Label extends Entity {
  setup(params: { text: string }): void {
    this.add(
      new Transform({ position: new Vec2(0, 38), scale: new Vec2(0.5, 0.5) }),
    );
    this.add(
      new TextComponent({
        text: params.text,
        anchor: { x: 0.5, y: 0 },
        style: LABEL_STYLE,
      }),
    );
  }
}

/** A labelled orb, drawn at twice its image size. */
class Orb extends Entity {
  setup(params: {
    x: number;
    y: number;
    label: string;
    texture?: TextureRef;
    maps?: SpriteMaps;
    material?: SpriteMaterial;
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
        texture: params.texture ?? images.orb,
        ...(params.maps && { maps: params.maps }),
        ...(params.material && { material: params.material }),
        anchor: { x: 0.5, y: 0.5 },
        alpha: params.alpha ?? 1,
      }),
    );
    if (params.glow) {
      sprite.fx.addEffect(
        bloom({ threshold: 0.6, bloomScale: 1.3, blur: 5, quality: 8 }),
      );
    }
    this.spawnChild("label", Label, { text: params.label });
  }
}

/** An orb whose color, normal and emission frames switch together. */
class PulsingOrb extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(
      new Transform({
        position: new Vec2(params.x, params.y),
        scale: new Vec2(2, 2),
      }),
    );
    // The maps belong to the frame source, so every frame switch swaps the
    // color frame and its maps at once.
    const source = {
      sheet: images.orbSheet,
      frameWidth: 64,
      count: 2,
      maps: {
        normal: images.orbSheetNormal,
        emission: images.orbSheetEmission,
      },
    };
    this.add(
      new AnimatedSpriteComponent({
        source,
        material: pulsing,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.add(new AnimationController({ pulse: { source, speed: 0.03 } }));
    this.spawnChild("label", Label, { text: "Animated maps" });
  }
}

/**
 * A normal-mapped crate that casts a shadow. Every pixel inside an occluder
 * is dark, so the occluder covers only the crate's footprint along its base,
 * and the face above it stays lit.
 */
class Crate extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new SpriteComponent({
        texture: images.crate,
        maps: { normal: images.crateNormal },
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    const half = TILE / 2;
    this.add(
      new LightOccluder({
        shape: {
          type: "polygon",
          vertices: [
            { x: -half, y: half - CRATE_FOOTPRINT },
            { x: half, y: half - CRATE_FOOTPRINT },
            { x: half, y: half },
            { x: -half, y: half },
          ],
        },
      }),
    );
  }
}

/** The light. Its marker is a Graphics shape, which is never lit. */
class Lamp extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    this.add(new LightSource({ radius: 520, height: 100, color: 0xffe0b0 }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 5).fill(0xffe0b0);
      }),
    );
    this.add(new LampControl());
  }
}

class Hud extends Entity {
  setup(params: { light: LightSource }): void {
    this.add(new Transform({ position: new Vec2(16, 12) }));
    this.add(
      new TextComponent({
        text: "",
        layer: HUD_LAYER,
        style: { fontFamily: "monospace", fontSize: 14, fill: 0xffffff },
      }),
    );
    this.add(new LampReadout(params.light));
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

class MaterialsScene extends Scene {
  readonly name = "materials";
  readonly preload = Object.values(images);
  readonly layers: readonly LayerDef[] = [
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  onEnter(): void {
    for (let y = 0; y < HEIGHT; y += TILE) {
      for (let x = 0; x < WIDTH; x += TILE) this.spawn(FloorTile, { x, y });
    }

    this.spawn(Orb, {
      x: 110,
      y: 120,
      label: "No maps",
    });
    this.spawn(Orb, {
      x: 300,
      y: 120,
      label: "Normal map",
      maps: { normal: images.orbNormal },
    });
    this.spawn(Orb, {
      x: 500,
      y: 120,
      label: "Specular map",
      texture: images.gildedOrb,
      maps: { normal: images.orbNormal, specular: images.gildedSpecular },
      material: polished,
    });
    this.spawn(PulsingOrb, { x: 690, y: 120 });

    this.spawn(Crate, { x: WIDTH / 2, y: 245 });

    this.spawn(Orb, {
      x: 110,
      y: 360,
      label: "unlitMaterial()",
      material: unlitMaterial(),
    });
    this.spawn(Orb, {
      x: 300,
      y: 360,
      label: "Emission + bloom",
      maps: { normal: images.orbNormal, emission: images.orbEmission },
      material: glowing,
      glow: true,
    });
    this.spawn(Orb, {
      x: 500,
      y: 360,
      label: "Alpha 0.5",
      maps: { normal: images.orbNormal },
      material: polished,
      alpha: 0.5,
    });

    const lamp = this.spawn(Lamp);
    this.spawn(Hud, { light: lamp.get(LightSource) });
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      container: setupGameContainer(WIDTH, HEIGHT),
      backgroundColor: 0x111c2b,
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        raise: ["ArrowUp", "KeyW"],
        lower: ["ArrowDown", "KeyS"],
      },
      preventDefaultKeys: ["ArrowUp", "ArrowDown"],
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
