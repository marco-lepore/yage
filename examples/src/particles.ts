import { Engine, Scene, Component, Transform, Vec2 } from "@yage/core";
import type { Entity } from "@yage/core";
import {
  RendererPlugin,
  RendererKey,
  CameraKey,
  GraphicsComponent,
} from "@yage/renderer";
import { InputPlugin, InputManagerKey } from "@yage/input";
import type { InputManager } from "@yage/input";
import {
  ParticlesPlugin,
  ParticleEmitterComponent,
  ParticlePresets,
} from "@yage/particles";
import type { EmitterConfig } from "@yage/particles";
import { Graphics } from "pixi.js";
import type { Texture } from "pixi.js";
import { injectStyles, getContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// Preset definitions (name → factory)
// ---------------------------------------------------------------------------
type PresetName = "fire" | "smoke" | "sparks" | "rain";

const PRESET_ACTIONS: Record<string, PresetName> = {
  preset_fire: "fire",
  preset_smoke: "smoke",
  preset_sparks: "sparks",
  preset_rain: "rain",
};

const PRESET_FACTORIES: Record<
  PresetName,
  (tex: Texture) => EmitterConfig
> = {
  fire: ParticlePresets.fire,
  smoke: ParticlePresets.smoke,
  sparks: ParticlePresets.sparks,
  rain: ParticlePresets.rain,
};

// ---------------------------------------------------------------------------
// ParticleController — follows mouse, hold to emit, space to burst,
//                      1-4 keys to switch presets
// ---------------------------------------------------------------------------
class ParticleController extends Component {
  private input!: InputManager;
  scene!: ParticlesScene;

  onAdd(): void {
    this.input = this.use(InputManagerKey);
    this.scene = this.entity.scene as ParticlesScene;
  }

  update(): void {
    const pos = this.input.getPointerPosition();
    this.entity.get(Transform).setPosition(pos.x, pos.y);

    const emitter = this.entity.get(ParticleEmitterComponent);

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

    // 1-4 → switch preset
    for (const [action, preset] of Object.entries(PRESET_ACTIONS)) {
      if (this.input.isJustPressed(action)) {
        this.scene.switchPreset(preset);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class ParticlesScene extends Scene {
  readonly name = "particles";

  private particleTex!: Texture;
  currentPreset: PresetName = "fire";
  private emitterEntity!: Entity;
  private presetIndicators = new Map<PresetName, GraphicsComponent>();

  onEnter(): void {
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(400, 300);

    // Generate a small white circle texture for particles
    const renderer = this.context.resolve(RendererKey);
    const gfx = new Graphics();
    gfx.circle(0, 0, 8).fill({ color: 0xffffff });
    this.particleTex = renderer.application.renderer.generateTexture(gfx);

    // Spawn emitter entity
    this.emitterEntity = this.spawnEmitter(this.currentPreset);

    // Crosshair at cursor
    const crosshair = this.spawn("crosshair");
    crosshair.add(new Transform());
    crosshair.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 6).stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
        g.moveTo(-10, 0).lineTo(10, 0).stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
        g.moveTo(0, -10).lineTo(0, 10).stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
      }),
    );
    crosshair.add(new CrosshairFollow());

    // Preset indicator dots at bottom of screen
    this.spawnPresetBar();
  }

  private spawnEmitter(preset: PresetName) {
    const config = PRESET_FACTORIES[preset](this.particleTex);
    const entity = this.spawn("emitter");
    entity.add(new Transform({ position: new Vec2(400, 300) }));
    entity.add(new ParticleEmitterComponent(config));
    entity.add(new ParticleController());
    return entity;
  }

  switchPreset(preset: PresetName): void {
    if (preset === this.currentPreset) return;
    const prevPreset = this.currentPreset;
    this.currentPreset = preset;

    // Destroy old emitter and create new one
    this.destroyEntity(this.emitterEntity);
    this.emitterEntity = this.spawnEmitter(preset);

    // Update preset bar indicators
    this.updatePresetBar(prevPreset, preset);
  }

  private spawnPresetBar(): void {
    const presets: PresetName[] = ["fire", "smoke", "sparks", "rain"];
    const colors: Record<PresetName, number> = {
      fire: 0xff6600,
      smoke: 0x888888,
      sparks: 0xffcc00,
      rain: 0xaaccff,
    };
    const startX = 400 - (presets.length - 1) * 30;

    for (let i = 0; i < presets.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const name = presets[i]!;
      const color = colors[name];
      const x = startX + i * 60;
      const entity = this.spawn(`preset-${name}`);
      entity.add(new Transform({ position: new Vec2(x, 570) }));
      const gfxComp = new GraphicsComponent();
      entity.add(gfxComp);
      this.presetIndicators.set(name, gfxComp);
      this.drawPresetDot(gfxComp, color, name === this.currentPreset);
    }
  }

  private drawPresetDot(
    gfxComp: GraphicsComponent,
    color: number,
    active: boolean,
  ): void {
    gfxComp.graphics.clear();
    gfxComp.draw((g) => {
      if (active) {
        g.circle(0, 0, 8).fill({ color });
        g.circle(0, 0, 11).stroke({ color: 0xffffff, width: 1, alpha: 0.6 });
      } else {
        g.circle(0, 0, 6).fill({ color, alpha: 0.3 });
      }
    });
  }

  private updatePresetBar(prev: PresetName, next: PresetName): void {
    const colors: Record<PresetName, number> = {
      fire: 0xff6600,
      smoke: 0x888888,
      sparks: 0xffcc00,
      rain: 0xaaccff,
    };
    const prevComp = this.presetIndicators.get(prev);
    if (prevComp) this.drawPresetDot(prevComp, colors[prev], false);
    const nextComp = this.presetIndicators.get(next);
    if (nextComp) this.drawPresetDot(nextComp, colors[next], true);
  }
}

// ---------------------------------------------------------------------------
// CrosshairFollow — tiny component to track mouse for the crosshair
// ---------------------------------------------------------------------------
class CrosshairFollow extends Component {
  private input!: InputManager;

  onAdd(): void {
    this.input = this.use(InputManagerKey);
  }

  update(): void {
    const pos = this.input.getPointerPosition();
    this.entity.get(Transform).setPosition(pos.x, pos.y);
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
      virtualWidth: 800,
      virtualHeight: 600,
      backgroundColor: 0x0a0a0a,
      container: getContainer(),
    }),
  );

  engine.use(
    new InputPlugin({
      actions: {
        burst: ["Space"],
        preset_fire: ["Digit1"],
        preset_smoke: ["Digit2"],
        preset_sparks: ["Digit3"],
        preset_rain: ["Digit4"],
      },
      preventDefaultKeys: ["Space"],
      cameraKey: CameraKey as never,
      rendererKey: RendererKey as never,
    }),
  );

  engine.use(new ParticlesPlugin());

  await engine.start();
  engine.scenes.push(new ParticlesScene());
}

main().catch(console.error);
