/**
 * Offscreen render targets and blend modes.
 *
 * A radar display is drawn into an offscreen texture, then the same live
 * texture is shown on a large wall monitor and a smaller console display.
 * The source container never joins the scene graph.
 *
 * R cycles `resolutionScale`. Both screens keep the same layout while the
 * texture gets sharper or chunkier. Space pauses the radar; once nothing
 * changes, `renderIfNeeded()` stops redrawing the buffer.
 *
 * The strip along the bottom demonstrates component `blendMode` without a
 * render target.
 */
import { Container, Graphics } from "pixi.js";
import {
  Component,
  Engine,
  Entity,
  ProcessComponent,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  RendererPlugin,
  SpriteComponent,
  TextComponent,
  registerTexture,
  unregisterTexture,
} from "@yagejs/renderer";
import type { LayerDef, RenderTargetHandle } from "@yagejs/renderer";
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
const RADAR_TEXTURE = "render-target-radar";
/** The `resolutionScale` values R cycles through. */
const SCALES = [1, 0.5, 0.25, 0.1];
/** Seconds over which the readout measures the redraw rate. */
const SAMPLE_SECONDS = 0.5;
const BLEND_MODES = ["normal", "add", "multiply", "screen"] as const;

// ---------------------------------------------------------------------------
// RadarSource — the offscreen Pixi container the render target draws
// ---------------------------------------------------------------------------
class RadarSource {
  readonly container = new Container();

  private readonly contacts = new Graphics();
  private readonly sweep = new Graphics();
  private elapsed = 0;

  constructor() {
    this.container.label = "offscreen-radar-source";

    const background = new Graphics();
    background.rect(0, 0, RADAR_WIDTH, RADAR_HEIGHT).fill(0x06131c);

    const grid = new Graphics();
    grid.rect(1, 1, RADAR_WIDTH - 2, RADAR_HEIGHT - 2).stroke({
      color: 0x4fe3b2,
      width: 2,
      alpha: 0.7,
    });
    for (let x = 40; x < RADAR_WIDTH; x += 40) {
      grid.moveTo(x, 0).lineTo(x, RADAR_HEIGHT).stroke({
        color: 0x2a8f76,
        width: 1,
        alpha: 0.35,
      });
    }
    for (let y = 40; y < RADAR_HEIGHT; y += 40) {
      grid.moveTo(0, y).lineTo(RADAR_WIDTH, y).stroke({
        color: 0x2a8f76,
        width: 1,
        alpha: 0.35,
      });
    }
    grid
      .circle(RADAR_WIDTH / 2, RADAR_HEIGHT / 2, 42)
      .stroke({ color: 0x4fe3b2, width: 1, alpha: 0.45 });
    grid
      .circle(RADAR_WIDTH / 2, RADAR_HEIGHT / 2, 84)
      .stroke({ color: 0x4fe3b2, width: 1, alpha: 0.3 });

    this.container.addChild(background, grid, this.contacts, this.sweep);
    this.advance(0);
  }

  advance(dt: number): void {
    this.elapsed += dt;

    const centerX = RADAR_WIDTH / 2;
    const centerY = RADAR_HEIGHT / 2;
    const angle = this.elapsed * 1.4;
    const sweepX = centerX + Math.cos(angle) * 104;
    const sweepY = centerY + Math.sin(angle) * 104;
    this.sweep
      .clear()
      .moveTo(centerX, centerY)
      .lineTo(sweepX, sweepY)
      .stroke({ color: 0x86ffd6, width: 3, alpha: 0.7 });

    this.contacts.clear();
    const movingContacts = [
      {
        x: centerX + Math.cos(this.elapsed * 0.8) * 112,
        y: centerY + Math.sin(this.elapsed * 1.1) * 72,
      },
      {
        x: centerX + Math.cos(this.elapsed * -0.55 + 2) * 78,
        y: centerY + Math.sin(this.elapsed * 0.7 + 2) * 90,
      },
      {
        x: centerX + Math.cos(this.elapsed * 0.35 + 4) * 130,
        y: centerY + Math.sin(this.elapsed * -0.6 + 4) * 58,
      },
    ];
    for (const contact of movingContacts) {
      this.contacts.circle(contact.x, contact.y, 5).fill(0xffcf5a);
      this.contacts.circle(contact.x, contact.y, 9).stroke({
        color: 0xffcf5a,
        width: 1,
        alpha: 0.45,
      });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// ---------------------------------------------------------------------------
// RadarFeed — the render target, its controls, and its redraw count
// ---------------------------------------------------------------------------

/**
 * Owns the radar source and the render target it draws into, and registers
 * the target's texture as `RADAR_TEXTURE` for the monitors to show. R cycles
 * the buffer's resolution; Space pauses the radar. The texture is
 * unregistered and freed when the component is destroyed.
 */
class RadarFeed extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly source = new RadarSource();
  private buffer!: RenderTargetHandle;
  private scaleIndex = 0;
  paused = false;
  /** Times the buffer was redrawn since the scene started. */
  redraws = 0;

  get target(): RenderTargetHandle {
    return this.buffer;
  }

  get resolutionScale(): number {
    return SCALES[this.scaleIndex] ?? 1;
  }

  onAdd(): void {
    this.buffer = this.use(RendererKey).createRenderTarget(
      this.source.container,
      {
        width: RADAR_WIDTH,
        height: RADAR_HEIGHT,
        resolutionScale: this.resolutionScale,
        antialias: true,
        clearColor: 0x06131c,
        label: "radar-feed",
      },
    );
    this.buffer.render();
    registerTexture(RADAR_TEXTURE, this.buffer.texture);
  }

  update(dt: number): void {
    if (this.input.isJustPressed("cycleResolution")) this.cycleResolution();
    if (this.input.isJustPressed("pauseRadar")) this.paused = !this.paused;

    if (!this.paused) {
      this.source.advance(dt);
      this.buffer.invalidate();
    }
    if (this.buffer.renderIfNeeded()) this.redraws++;
  }

  onDestroy(): void {
    unregisterTexture(RADAR_TEXTURE);
    this.buffer.destroy();
    this.source.destroy();
  }

  private cycleResolution(): void {
    this.scaleIndex = (this.scaleIndex + 1) % SCALES.length;
    this.buffer.resize(RADAR_WIDTH, RADAR_HEIGHT, this.resolutionScale);
  }
}

class RadarEntity extends Entity {
  feed!: RadarFeed;

  setup(): void {
    this.feed = this.add(new RadarFeed());
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

  constructor(private readonly feed: RadarFeed) {
    super();
  }

  onAdd(): void {
    this.measuring = this.processes
      .slot({ duration: SAMPLE_SECONDS, onComplete: () => this.measure() })
      .start();
  }

  update(): void {
    const target = this.feed.target;
    const scale = target.resolution / window.devicePixelRatio;
    const texelWidth = Math.round(target.width * scale);
    const texelHeight = Math.round(target.height * scale);
    this.text.setText(
      `one offscreen texture → two screens\n` +
        `buffer ${target.width}x${target.height} @ ${scale.toFixed(2)}x ` +
        `(${texelWidth}x${texelHeight} texels)\n` +
        `redraws/sec ${this.redrawsPerSecond}` +
        (this.feed.paused ? " — radar paused" : ""),
    );
  }

  /** Redraws per second over the window that just ended. */
  private measure(): void {
    this.redrawsPerSecond = Math.round(
      (this.feed.redraws - this.lastRedraws) / this.measuring.elapsed,
    );
    this.lastRedraws = this.feed.redraws;
    this.measuring.start();
  }
}

class ReadoutEntity extends Entity {
  setup(params: { feed: RadarFeed }): void {
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
    this.add(new Readout(params.feed));
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
    { name: "world", order: 0 },
    { name: "screens", order: 10 },
    { name: "blend-demo", order: 20 },
    { name: "hud", order: 30 },
  ];

  onEnter(): void {
    this.drawConsole();

    // The feed registers the texture the monitors show, so it spawns first.
    const radar = this.spawn(RadarEntity);
    this.spawn(MonitorEntity, { position: new Vec2(250, 200), scale: 1 });
    this.spawn(MonitorEntity, { position: new Vec2(640, 178.5), scale: 0.55 });
    this.spawn(ReadoutEntity, { feed: radar.feed });

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
