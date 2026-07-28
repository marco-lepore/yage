import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  LightSource,
  LightingPlugin,
  LightingWorldKey,
} from "@yagejs/lighting";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;

class Orbit extends Component {
  private readonly transform = this.sibling(Transform);
  private elapsed = 0;

  update(dt: number): void {
    this.elapsed += dt;
    this.transform.setPosition(
      400 + Math.cos(this.elapsed * 0.7) * 230,
      280 + Math.sin(this.elapsed * 1.1) * 120,
    );
  }
}

class LightProbe extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly lighting = this.service(LightingWorldKey);
  private elapsed = 0;

  constructor(private readonly readout: TextComponent) {
    super();
  }

  update(dt: number): void {
    this.elapsed += dt;
    const x = 80 + ((this.elapsed * 75) % 640);
    const y = 410 + Math.sin(this.elapsed * 1.6) * 55;
    this.transform.setPosition(x, y);

    const level = this.lighting.levelAt(x, y);
    this.readout.setText(
      `probe (${x.toFixed(0)}, ${y.toFixed(0)})  light ${level.toFixed(2)}`,
    );
  }
}

class LightingScene extends Scene {
  readonly name = "lighting";
  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: "markers", order: 10 },
    { name: "hud", order: 1000 },
  ];

  onEnter(): void {
    this.drawRoom();

    this.spawnLamp("warm-lamp", 220, 210, 190, 0xffa34d, 0.95);
    this.spawnLamp("cool-lamp", 590, 205, 165, 0x66aaff, 0.85);

    const orbiting = this.spawnLamp(
      "orbiting-lamp",
      400,
      280,
      140,
      0xff66b8,
      0.7,
    );
    orbiting.add(new Orbit());

    const hud = this.spawn("light-readout");
    hud.add(new Transform({ position: new Vec2(18, 16) }));
    const readout = hud.add(
      new TextComponent({
        text: "probe",
        layer: "hud",
        style: {
          fontFamily: "monospace",
          fontSize: 16,
          fill: 0xffffff,
          dropShadow: {
            color: 0x000000,
            alpha: 0.8,
            blur: 2,
            distance: 1,
          },
        },
      }),
    );

    const probe = this.spawn("light-probe");
    probe.add(new Transform({ position: new Vec2(80, 410) }));
    probe.add(
      new GraphicsComponent({ layer: "markers" }).draw((graphics) => {
        graphics.circle(0, 0, 7).fill(0xffffff);
        graphics.circle(0, 0, 12).stroke({
          color: 0xffffff,
          width: 2,
          alpha: 0.65,
        });
      }),
    );
    probe.add(new LightProbe(readout));
  }

  private drawRoom(): void {
    const room = this.spawn("room");
    room.add(new Transform());
    room.add(
      new GraphicsComponent({ layer: "world" }).draw((graphics) => {
        graphics.rect(0, 0, WIDTH, HEIGHT).fill(0x283342);
        graphics.rect(40, 70, 720, 460).fill(0x566273);
        graphics.rect(75, 105, 300, 210).fill(0x3b7866);
        graphics.rect(425, 105, 300, 210).fill(0x415e91);
        graphics.rect(75, 350, 650, 145).fill(0x7a4c5f);

        graphics.rect(365, 70, 70, 280).fill(0x252d39);
        graphics.rect(300, 430, 200, 40).fill(0xb2773c);
        graphics.circle(155, 435, 42).fill(0x2d8f68);
        graphics.circle(645, 430, 48).fill(0x416eb0);
      }),
    );
  }

  private spawnLamp(
    name: string,
    x: number,
    y: number,
    radius: number,
    color: number,
    intensity: number,
  ) {
    const lamp = this.spawn(name);
    lamp.add(new Transform({ position: new Vec2(x, y) }));
    lamp.add(
      new GraphicsComponent({ layer: "markers" }).draw((graphics) => {
        graphics.circle(0, 0, 8).fill(color);
        graphics.circle(0, 0, 13).stroke({
          color,
          width: 2,
          alpha: 0.8,
        });
      }),
    );
    lamp.add(new LightSource({ radius, intensity, color }));
    return lamp;
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x10141c,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new LightingPlugin({
      ambient: { level: 0.22, color: 0xb0b8cc },
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new LightingScene());
}

main().catch(console.error);
