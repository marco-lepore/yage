/**
 * Offscreen render targets and blend modes.
 *
 * The radar is a layer declared with `renderTarget`, so it draws into a
 * texture, not the screen. Its grid, sweep and contacts are ordinary
 * entities on that layer, moved through their `Transform`. The same live
 * texture is shown on a large wall monitor and a smaller console display.
 *
 * R cycles `resolutionScale`. Both screens keep the same layout while the
 * texture gets sharper or chunkier. Space pauses the radar. The layer
 * redraws on demand, so once nothing moves the texture stops redrawing.
 *
 * The strip along the bottom demonstrates component `blendMode` without a
 * render target.
 */
import {
  Component,
  Engine,
  Entity,
  ProcessComponent,
  Scene,
  Transform,
  Vec2,
  InspectorPlugin,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  SceneRenderTreeKey,
  SpriteComponent,
  TextComponent,
} from "@yagejs/renderer";
import type { LayerDef, LayerRenderTarget } from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const RADAR_WIDTH = 320;
const RADAR_HEIGHT = 220;
const RADAR_CENTER = new Vec2(RADAR_WIDTH / 2, RADAR_HEIGHT / 2);
const RADAR_LAYER = "radar";
const RADAR_TEXTURE = "render-target-radar";
/** The `resolutionScale` values R cycles through. */
const SCALES = [1, 0.5, 0.25, 0.1];
/** Seconds over which the readout measures the redraw rate. */
const SAMPLE_SECONDS = 0.5;
const BLEND_MODES = ["normal", "add", "multiply", "screen"] as const;

// ---------------------------------------------------------------------------
// Radar — entities on the render-target layer
// ---------------------------------------------------------------------------

/** How one contact drifts around the radar centre. */
interface ContactPath {
  radius: Vec2;
  speed: Vec2;
  phase: number;
}

const CONTACT_PATHS: readonly ContactPath[] = [
  { radius: new Vec2(112, 72), speed: new Vec2(0.8, 1.1), phase: 0 },
  { radius: new Vec2(78, 90), speed: new Vec2(-0.55, 0.7), phase: 2 },
  { radius: new Vec2(130, 58), speed: new Vec2(0.35, -0.6), phase: 4 },
];

/** Places a contact on its path at a given radar time. */
class ContactMotion extends Component {
  private readonly transform = this.sibling(Transform);

  constructor(private readonly path: ContactPath) {
    super();
  }

  moveTo(elapsed: number): void {
    const { radius, speed, phase } = this.path;
    this.transform.setPosition(
      RADAR_CENTER.x + Math.cos(elapsed * speed.x + phase) * radius.x,
      RADAR_CENTER.y + Math.sin(elapsed * speed.y + phase) * radius.y,
    );
  }
}

class ContactEntity extends Entity {
  motion!: ContactMotion;

  setup(params: { path: ContactPath }): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: RADAR_LAYER }).draw((g) => {
        g.circle(0, 0, 5).fill(0xffcf5a);
        g.circle(0, 0, 9).stroke({ color: 0xffcf5a, width: 1, alpha: 0.45 });
      }),
    );
    this.motion = this.add(new ContactMotion(params.path));
  }
}

/**
 * Runs the radar: turns the sweep, moves the contacts, and asks the layer's
 * texture to redraw. R cycles the texture's resolution; Space pauses the
 * radar, which stops the redraws.
 */
class RadarScan extends Component {
  private readonly input = this.service(InputManagerKey);
  private _target!: LayerRenderTarget;
  private elapsed = 0;
  private scaleIndex = 0;
  paused = false;
  /** Redraws asked of the texture since the scene started. */
  redraws = 0;

  constructor(
    private readonly sweep: Transform,
    private readonly contacts: readonly ContactMotion[],
  ) {
    super();
  }

  get target(): LayerRenderTarget {
    return this._target;
  }

  onAdd(): void {
    const target = this.use(SceneRenderTreeKey).get(RADAR_LAYER).renderTarget;
    if (!target) {
      throw new Error(`RadarScan: layer "${RADAR_LAYER}" has no renderTarget.`);
    }
    this._target = target;
    this.place();
  }

  update(dt: number): void {
    if (this.input.isJustPressed("cycleResolution")) this.cycleResolution();
    if (this.input.isJustPressed("pauseRadar")) this.paused = !this.paused;
    if (this.paused) return;

    this.elapsed += dt;
    this.place();
    this._target.invalidate();
    this.redraws++;
  }

  private place(): void {
    this.sweep.setRotation(this.elapsed * 1.4);
    for (const contact of this.contacts) contact.moveTo(this.elapsed);
  }

  private cycleResolution(): void {
    this.scaleIndex = (this.scaleIndex + 1) % SCALES.length;
    // A resize redraws the texture once, paused or not.
    this._target.resize(RADAR_WIDTH, RADAR_HEIGHT, SCALES[this.scaleIndex]);
    this.redraws++;
  }
}

class RadarEntity extends Entity {
  scan!: RadarScan;

  setup(): void {
    this.add(new Transform());

    const grid = this.spawnChild("grid");
    grid.add(new Transform());
    grid.add(
      new GraphicsComponent({ layer: RADAR_LAYER }).draw((g) => {
        g.rect(1, 1, RADAR_WIDTH - 2, RADAR_HEIGHT - 2).stroke({
          color: 0x4fe3b2,
          width: 2,
          alpha: 0.7,
        });
        for (let x = 40; x < RADAR_WIDTH; x += 40) {
          g.moveTo(x, 0)
            .lineTo(x, RADAR_HEIGHT)
            .stroke({ color: 0x2a8f76, width: 1, alpha: 0.35 });
        }
        for (let y = 40; y < RADAR_HEIGHT; y += 40) {
          g.moveTo(0, y)
            .lineTo(RADAR_WIDTH, y)
            .stroke({ color: 0x2a8f76, width: 1, alpha: 0.35 });
        }
        g.circle(RADAR_CENTER.x, RADAR_CENTER.y, 42).stroke({
          color: 0x4fe3b2,
          width: 1,
          alpha: 0.45,
        });
        g.circle(RADAR_CENTER.x, RADAR_CENTER.y, 84).stroke({
          color: 0x4fe3b2,
          width: 1,
          alpha: 0.3,
        });
      }),
    );

    const contacts = CONTACT_PATHS.map(
      (path, index) =>
        this.spawnChild(`contact-${index}`, ContactEntity, { path }).motion,
    );

    const sweep = this.spawnChild("sweep");
    const sweepTransform = sweep.add(new Transform({ position: RADAR_CENTER }));
    sweep.add(
      new GraphicsComponent({ layer: RADAR_LAYER }).draw((g) => {
        g.moveTo(0, 0)
          .lineTo(104, 0)
          .stroke({ color: 0x86ffd6, width: 3, alpha: 0.7 });
      }),
    );

    this.scan = this.add(new RadarScan(sweepTransform, contacts));
  }
}

// ---------------------------------------------------------------------------
// Readout — buffer size, texel count and redraw rate
// ---------------------------------------------------------------------------
class Readout extends Component {
  private readonly text = this.sibling(TextComponent);
  private readonly processes = this.sibling(ProcessComponent);
  /** Runs for one measuring window; restarted after each reading. */
  private measuring!: ProcessSlot;
  private lastRedraws = 0;
  redrawsPerSecond = 0;

  constructor(private readonly scan: RadarScan) {
    super();
  }

  onAdd(): void {
    this.measuring = this.processes
      .slot({ duration: SAMPLE_SECONDS, onComplete: () => this.measure() })
      .start();
  }

  update(): void {
    const target = this.scan.target;
    const scale = target.resolution / window.devicePixelRatio;
    const texelWidth = Math.round(target.width * scale);
    const texelHeight = Math.round(target.height * scale);
    this.text.setText(
      `one offscreen texture → two screens\n` +
        `buffer ${target.width}x${target.height} @ ${scale.toFixed(2)}x ` +
        `(${texelWidth}x${texelHeight} texels)\n` +
        `redraws/sec ${this.redrawsPerSecond}` +
        (this.scan.paused ? " — radar paused" : ""),
    );
  }

  /** Redraws per second over the window that just ended. */
  private measure(): void {
    this.redrawsPerSecond = Math.round(
      (this.scan.redraws - this.lastRedraws) / this.measuring.elapsed,
    );
    this.lastRedraws = this.scan.redraws;
    this.measuring.start();
  }
}

class ReadoutEntity extends Entity {
  setup(params: { scan: RadarScan }): void {
    this.add(new Transform({ position: new Vec2(470, 320) }));
    this.add(
      new TextComponent({
        text: "",
        layer: "hud",
        style: {
          fontFamily: "monospace",
          fontSize: 14,
          fill: 0xa7f3d0,
          lineHeight: 20,
        },
      }),
    );
    this.add(new ProcessComponent());
    this.add(new Readout(params.scan));
  }
}

// ---------------------------------------------------------------------------
// Monitors and blend swatches
// ---------------------------------------------------------------------------

/** A screen showing the radar texture, centred on `position`. */
class MonitorEntity extends Entity {
  setup(params: { position: Vec2; scale: number }): void {
    this.add(
      new Transform({
        position: params.position,
        scale: new Vec2(params.scale, params.scale),
      }),
    );
    this.add(
      new SpriteComponent({
        texture: RADAR_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
        layer: "screens",
      }),
    );
  }
}

/** An orange square drawn with one blend mode, labelled underneath. */
class BlendSwatchEntity extends Entity {
  setup(params: { mode: (typeof BLEND_MODES)[number]; x: number }): void {
    const { mode, x } = params;
    this.add(new Transform({ position: new Vec2(x, 420) }));
    this.add(
      new GraphicsComponent({ layer: "blend-demo", blendMode: mode }).draw(
        (graphics) => {
          graphics.roundRect(-42, 0, 84, 90, 8).fill({ color: 0xf0a43c });
        },
      ),
    );

    const label = this.spawnChild("label");
    label.add(new Transform({ position: new Vec2(0, 92) }));
    label.add(
      new TextComponent({
        text: mode,
        layer: "hud",
        anchor: { x: 0.5, y: 0 },
        style: { fontFamily: "monospace", fontSize: 13, fill: 0xcbd5e1 },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class RenderTargetScene extends Scene {
  readonly name = "render-targets";
  readonly layers: readonly LayerDef[] = [
    {
      name: RADAR_LAYER,
      order: 0,
      renderTarget: {
        width: RADAR_WIDTH,
        height: RADAR_HEIGHT,
        texture: RADAR_TEXTURE,
        refresh: "on-demand",
        antialias: true,
        clearColor: 0x06131c,
        label: "radar-feed",
      },
    },
    { name: "world", order: 0 },
    { name: "screens", order: 10 },
    { name: "blend-demo", order: 20 },
    { name: "hud", order: 30 },
  ];

  onEnter(): void {
    this.drawConsole();

    const radar = this.spawn(RadarEntity);
    this.spawn(MonitorEntity, { position: new Vec2(250, 200), scale: 1 });
    this.spawn(MonitorEntity, { position: new Vec2(640, 178.5), scale: 0.55 });
    this.spawn(ReadoutEntity, { scan: radar.scan });

    const caption = this.spawn("radar-caption");
    caption.add(new Transform({ position: new Vec2(84, 332) }));
    caption.add(
      new TextComponent({
        text: "WALL MONITOR",
        layer: "hud",
        style: { fontFamily: "monospace", fontSize: 13, fill: 0x94a3b8 },
      }),
    );

    BLEND_MODES.forEach((mode, index) => {
      this.spawn(BlendSwatchEntity, { mode, x: 145 + index * 170 });
    });
  }

  private drawConsole(): void {
    const consoleEntity = this.spawn("console");
    consoleEntity.add(new Transform());
    consoleEntity.add(
      new GraphicsComponent({ layer: "world" }).draw((graphics) => {
        graphics.rect(0, 0, WIDTH, HEIGHT).fill(0x151b26);

        graphics.roundRect(65, 65, 370, 300, 18).fill(0x2b3445);
        graphics
          .roundRect(75, 75, 350, 280, 14)
          .stroke({ color: 0x7f91a9, width: 3 });
        graphics.rect(90, 90, RADAR_WIDTH, RADAR_HEIGHT).fill(0x05080d);

        graphics.roundRect(520, 85, 240, 220, 18).fill(0x252e3c);
        graphics
          .roundRect(530, 95, 220, 200, 14)
          .stroke({ color: 0x64748b, width: 3 });
        graphics.rect(552, 118, 176, 121).fill(0x05080d);

        graphics.roundRect(45, 390, 710, 150, 16).fill(0x202735);
        graphics.rect(70, 430, 660, 70).fill(0x56627b);
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        cycleResolution: ["KeyR"],
        pauseRadar: ["Space"],
      },
      preventDefaultKeys: ["Space"],
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new RenderTargetScene());
}

main().catch(console.error);
