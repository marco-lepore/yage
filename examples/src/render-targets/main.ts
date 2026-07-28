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
import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
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
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;
const RADAR_WIDTH = 320;
const RADAR_HEIGHT = 220;
const RADAR_TEXTURE = "render-target-radar";
const SCALES = [1, 0.5, 0.25, 0.1];

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

class RadarDriver extends Component {
  paused = false;
  redraws = 0;

  constructor(
    private readonly source: RadarSource,
    private readonly target: RenderTargetHandle,
  ) {
    super();
  }

  update(dt: number): void {
    if (!this.paused) {
      this.source.advance(dt);
      this.target.invalidate();
    }
    if (this.target.renderIfNeeded()) this.redraws++;
  }
}

class Readout extends Component {
  private readonly text = this.sibling(TextComponent);
  private elapsed = 0;
  private lastRedraws = 0;
  private redrawsPerSecond = 0;

  constructor(
    private readonly driver: RadarDriver,
    private readonly target: RenderTargetHandle,
  ) {
    super();
  }

  update(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.redrawsPerSecond = Math.round(
        (this.driver.redraws - this.lastRedraws) / this.elapsed,
      );
      this.lastRedraws = this.driver.redraws;
      this.elapsed = 0;
    }

    const scale = this.target.resolution / window.devicePixelRatio;
    const texelWidth = Math.round(this.target.width * scale);
    const texelHeight = Math.round(this.target.height * scale);
    this.text.setText(
      `one offscreen texture → two screens\n` +
        `buffer ${this.target.width}x${this.target.height} @ ${scale.toFixed(2)}x ` +
        `(${texelWidth}x${texelHeight} texels)\n` +
        `redraws/sec ${this.redrawsPerSecond}` +
        (this.driver.paused ? " — radar paused" : ""),
    );
  }
}

class RenderTargetScene extends Scene {
  readonly name = "render-targets";
  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: "screens", order: 10 },
    { name: "blend-demo", order: 20 },
    { name: "hud", order: 30 },
  ];

  private source: RadarSource | undefined;
  private target: RenderTargetHandle | undefined;
  private driver: RadarDriver | undefined;
  private scaleIndex = 0;
  private onKey: ((event: KeyboardEvent) => void) | undefined;

  private get resolutionScale(): number {
    return SCALES[this.scaleIndex] ?? 1;
  }

  onEnter(): void {
    this.drawConsole();
    this.createRadarTarget();
    this.drawBlendStrip();
    this.bindKeys();
  }

  onExit(): void {
    if (this.onKey) window.removeEventListener("keydown", this.onKey);
    unregisterTexture(RADAR_TEXTURE);
    this.target?.destroy();
    this.source?.destroy();
  }

  private drawConsole(): void {
    const console = this.spawn("console");
    console.add(new Transform());
    console.add(
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

  private createRadarTarget(): void {
    const renderer = this.context.resolve(RendererKey);
    const source = new RadarSource();
    const target = renderer.createRenderTarget(source.container, {
      width: RADAR_WIDTH,
      height: RADAR_HEIGHT,
      resolutionScale: this.resolutionScale,
      antialias: true,
      clearColor: 0x06131c,
      label: "radar-feed",
    });
    source.advance(0);
    target.render();
    registerTexture(RADAR_TEXTURE, target.texture);

    this.source = source;
    this.target = target;

    const wallMonitor = this.spawn("wall-monitor-feed");
    wallMonitor.add(new Transform({ position: new Vec2(250, 200) }));
    wallMonitor.add(
      new SpriteComponent({
        texture: RADAR_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
        layer: "screens",
      }),
    );

    const consoleMonitor = this.spawn("console-monitor-feed");
    consoleMonitor.add(
      new Transform({
        position: new Vec2(640, 178.5),
        scale: new Vec2(0.55, 0.55),
      }),
    );
    consoleMonitor.add(
      new SpriteComponent({
        texture: RADAR_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
        layer: "screens",
      }),
    );

    const driver = wallMonitor.add(new RadarDriver(source, target));
    this.driver = driver;

    const hud = this.spawn("render-target-readout");
    hud.add(new Transform({ position: new Vec2(470, 320) }));
    hud.add(
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
    hud.add(new Readout(driver, target));

    const caption = this.spawn("radar-caption");
    caption.add(new Transform({ position: new Vec2(84, 332) }));
    caption.add(
      new TextComponent({
        text: "WALL MONITOR",
        layer: "hud",
        style: { fontFamily: "monospace", fontSize: 13, fill: 0x94a3b8 },
      }),
    );
  }

  private drawBlendStrip(): void {
    const modes = ["normal", "add", "multiply", "screen"] as const;
    modes.forEach((mode, index) => {
      const x = 145 + index * 170;
      const square = this.spawn(`blend-${mode}`);
      square.add(new Transform());
      square.add(
        new GraphicsComponent({
          layer: "blend-demo",
          blendMode: mode,
        }).draw((graphics) => {
          graphics.roundRect(x - 42, 420, 84, 90, 8).fill({ color: 0xf0a43c });
        }),
      );

      const label = this.spawn(`blend-label-${mode}`);
      label.add(new Transform({ position: new Vec2(x, 512) }));
      label.add(
        new TextComponent({
          text: mode,
          layer: "hud",
          anchor: { x: 0.5, y: 0 },
          style: { fontFamily: "monospace", fontSize: 13, fill: 0xcbd5e1 },
        }),
      );
    });
  }

  private bindKeys(): void {
    this.onKey = (event: KeyboardEvent) => {
      if (event.key === "r" || event.key === "R") {
        this.scaleIndex = (this.scaleIndex + 1) % SCALES.length;
        this.target?.resize(RADAR_WIDTH, RADAR_HEIGHT, this.resolutionScale);
      } else if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        if (this.driver) this.driver.paused = !this.driver.paused;
      }
    };
    window.addEventListener("keydown", this.onKey);
  }
}

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
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new RenderTargetScene());
}

main().catch(console.error);
