import {
  Engine,
  Scene,
  Component,
  Entity,
  Transform,
  Vec2,
  defineEvent,
} from "@yagejs/core";
import {
  RendererPlugin,
  RendererKey,
  CameraEntity,
  GraphicsComponent,
  type TextureResource,
} from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  ParticlesPlugin,
  ParticleEmitterComponent,
  ParticlePresets,
} from "@yagejs/particles";
import type {
  EmitterConfig,
  ShapeConfig,
  TextureSource,
} from "@yagejs/particles";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Demos (name → emitter config)
//
// 1-4 are the built-in presets called with no argument, so each falls back to
// its own generated shape and the example needs no art for them at all.
// 5-0 show the six shapes on their own under identical motion, so the texture
// is the only thing that differs between them.
// T passes a texture instead, which is what you use for your own art.
// ---------------------------------------------------------------------------
type DemoName =
  | "fire"
  | "smoke"
  | "sparks"
  | "rain"
  | "pixel"
  | "circle"
  | "softCircle"
  | "diamond"
  | "softDiamond"
  | "line"
  | "texture";

const DEMO_ORDER: DemoName[] = [
  "fire",
  "smoke",
  "sparks",
  "rain",
  "pixel",
  "circle",
  "softCircle",
  "diamond",
  "softDiamond",
  "line",
  "texture",
];

/** The demo playing when the page opens. */
const INITIAL_DEMO: DemoName = "fire";

/** Emitted on the selector when a key picks a different demo. */
const DemoSelected = defineEvent<{ demo: DemoName }>("particles:demo-selected");

const DEMO_ACTIONS: Record<string, DemoName> = {
  demo_fire: "fire",
  demo_smoke: "smoke",
  demo_sparks: "sparks",
  demo_rain: "rain",
  demo_pixel: "pixel",
  demo_circle: "circle",
  demo_soft_circle: "softCircle",
  demo_diamond: "diamond",
  demo_soft_diamond: "softDiamond",
  demo_line: "line",
  demo_texture: "texture",
};

/** Motion shared by every shape demo, so only the texture differs. */
function demoWith(source: TextureSource, tint: number): EmitterConfig {
  return {
    ...source,
    maxParticles: 250,
    rate: 35,
    lifetime: [0.7, 1.3],
    speed: [50, 120],
    angle: [0, Math.PI * 2],
    alpha: { start: 1, end: 0 },
    tint,
  };
}

function shapeDemo(shape: ShapeConfig, tint: number): EmitterConfig {
  return demoWith({ shape }, tint);
}

const DEMO_CONFIGS: Record<DemoName, (tex: TextureResource) => EmitterConfig> =
  {
    // fire and sparks emit light: additive blending brightens the background
    // where their particles overlap instead of covering it.
    fire: () => ({ ...ParticlePresets.fire(), blendMode: "add" }),
    smoke: () => ParticlePresets.smoke(),
    sparks: () => ({ ...ParticlePresets.sparks(), blendMode: "add" }),
    rain: () => ParticlePresets.rain(),

    pixel: () => shapeDemo({ type: "pixel", size: 4 }, 0xffffff),
    circle: () => shapeDemo({ type: "circle", size: 14 }, 0x66ddff),
    softCircle: () => shapeDemo({ type: "softCircle", size: 22 }, 0xff88cc),
    diamond: () => shapeDemo({ type: "diamond", size: 14 }, 0x88ff88),
    softDiamond: () => shapeDemo({ type: "softDiamond", size: 22 }, 0xffdd55),
    // A non-square size: the texture is taller than it is wide, so the streak
    // falls vertically without any rotation.
    line: () => shapeDemo({ type: "line", size: [3, 20] }, 0x99ffcc),

    texture: (tex) => demoWith({ texture: tex }, 0xffaa66),
  };

// ---------------------------------------------------------------------------
// Emitter — follows the mouse, hold to emit, space to burst
// ---------------------------------------------------------------------------
class ParticleController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly emitter = this.sibling(ParticleEmitterComponent);

  update(): void {
    const pos = this.input.getPointerPosition();
    this.transform.setPosition(pos.x, pos.y);

    const emitter = this.emitter;

    // Hold click → continuous emit
    if (this.input.isPointerDown()) {
      if (!emitter.isEmitting) emitter.emit();
    } else {
      if (emitter.isEmitting) emitter.stop();
    }

    // Space → burst
    if (this.input.isJustPressed("burst")) {
      emitter.burst(30, pos.x, pos.y);
    }
  }
}

class EmitterEntity extends Entity {
  setup(params: { config: EmitterConfig }): void {
    this.add(new Transform({ position: new Vec2(400, 300) }));
    this.add(new ParticleEmitterComponent(params.config));
    this.add(new ParticleController());
  }
}

// ---------------------------------------------------------------------------
// Demo selection — 1-0 and T switch the demo
// ---------------------------------------------------------------------------

/**
 * Holds the demo that is playing. Switching destroys the emitter and spawns
 * a new one from the chosen demo's config.
 */
class DemoSelector extends Component {
  private readonly input = this.service(InputManagerKey);
  private current: DemoName = INITIAL_DEMO;
  private texture!: TextureResource;
  private emitter!: EmitterEntity;

  onAdd(): void {
    // Only the "texture" demo needs this — every other demo uses a built-in
    // shape and loads nothing. The selector outlives every emitter it
    // spawns, so it releases the texture.
    const texture = this.use(RendererKey).createTexture((g) => {
      g.circle(0, 0, 8).fill({ color: 0xffffff });
    });
    this.texture = texture;
    this.addCleanup(() => texture.destroy());

    this.emitter = this.scene.spawn(EmitterEntity, {
      config: DEMO_CONFIGS[this.current](this.texture),
    });
  }

  update(): void {
    for (const [action, demo] of Object.entries(DEMO_ACTIONS)) {
      if (this.input.isJustPressed(action)) {
        this.select(demo);
        break;
      }
    }
  }

  private select(demo: DemoName): void {
    if (demo === this.current) return;
    this.current = demo;
    this.emitter.destroy();
    this.emitter = this.scene.spawn(EmitterEntity, {
      config: DEMO_CONFIGS[demo](this.texture),
    });
    this.entity.emit(DemoSelected, { demo });
  }
}

class DemoSelectorEntity extends Entity {
  setup(): void {
    this.add(new DemoSelector());
  }
}

// ---------------------------------------------------------------------------
// Demo bar — one dot per demo at the bottom of the screen
// ---------------------------------------------------------------------------
const DEMO_COLORS: Record<DemoName, number> = {
  fire: 0xff6600,
  smoke: 0x888888,
  sparks: 0xffcc00,
  rain: 0xaaccff,
  pixel: 0xffffff,
  circle: 0x66ddff,
  softCircle: 0xff88cc,
  diamond: 0x88ff88,
  softDiamond: 0xffdd55,
  line: 0x99ffcc,
  texture: 0xffaa66,
};

/** Draws its demo's dot, large and ringed while that demo is playing. */
class DemoDot extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);

  constructor(private readonly demo: DemoName) {
    super();
  }

  onAdd(): void {
    this.draw(this.demo === INITIAL_DEMO);
    this.listenScene(DemoSelected, ({ demo }) => this.draw(demo === this.demo));
  }

  private draw(active: boolean): void {
    const color = DEMO_COLORS[this.demo];
    this.graphics.draw((g) => {
      g.clear();
      if (active) {
        g.circle(0, 0, 8).fill({ color });
        g.circle(0, 0, 11).stroke({ color: 0xffffff, width: 1, alpha: 0.6 });
      } else {
        g.circle(0, 0, 6).fill({ color, alpha: 0.3 });
      }
    });
  }
}

class DemoDotEntity extends Entity {
  setup(params: { demo: DemoName; x: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, 570) }));
    this.add(new GraphicsComponent());
    this.add(new DemoDot(params.demo));
  }
}

// ---------------------------------------------------------------------------
// Crosshair — tracks the mouse
// ---------------------------------------------------------------------------
class CrosshairFollow extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  update(): void {
    const pos = this.input.getPointerPosition();
    this.transform.setPosition(pos.x, pos.y);
  }
}

class CrosshairEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 6).stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
        g.moveTo(-10, 0)
          .lineTo(10, 0)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
        g.moveTo(0, -10)
          .lineTo(0, 10)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
      }),
    );
    this.add(new CrosshairFollow());
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class ParticlesScene extends Scene {
  readonly name = "particles";

  onEnter(): void {
    const cam = this.spawn(CameraEntity, { position: new Vec2(400, 300) });
    const input = this.context.resolve(InputManagerKey);
    input.setCamera(cam);

    // The selector spawns the emitter for the current demo.
    this.spawn(DemoSelectorEntity);
    this.spawn(CrosshairEntity);

    // Demo indicator dots at bottom of screen
    const spacing = 56;
    const startX = 400 - ((DEMO_ORDER.length - 1) * spacing) / 2;
    DEMO_ORDER.forEach((demo, i) => {
      this.spawn(DemoDotEntity, { demo, x: startX + i * spacing });
    });
  }

  onExit(): void {
    this.context.resolve(InputManagerKey).clearCamera();
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(800, 600),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        burst: ["Space"],
        demo_fire: ["Digit1"],
        demo_smoke: ["Digit2"],
        demo_sparks: ["Digit3"],
        demo_rain: ["Digit4"],
        demo_pixel: ["Digit5"],
        demo_circle: ["Digit6"],
        demo_soft_circle: ["Digit7"],
        demo_diamond: ["Digit8"],
        demo_soft_diamond: ["Digit9"],
        demo_line: ["Digit0"],
        demo_texture: ["KeyT"],
      },
      preventDefaultKeys: ["Space"],
    }),
  );
  engine.use(new ParticlesPlugin());
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new ParticlesScene());
}

main().catch(console.error);
