import {
  Component,
  Engine,
  Scene,
  Transform,
  Vec2,
  InspectorPlugin,
} from "@yagejs/core";
import {
  LightOccluder,
  LightSource,
  LightingPlugin,
  LightingWorldKey,
  overlayLighting,
  shaderLighting,
} from "@yagejs/lighting";
import type { BounceLightOptions, LightOccluderShape } from "@yagejs/lighting";
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

// The page reads its look from the address bar, so the two renderers and the
// settings that tell them apart can be compared on the same room.
const params = new URLSearchParams(window.location.search);
const rendererName = params.get("renderer") === "hard" ? "hard" : "soft";
const lampSize = Number(params.get("size") ?? 20);
const coneSoftness = Number(params.get("softness") ?? 0.4);
const bounceStrength = Number(params.get("bounce") ?? 0);
const resolutionScale = Number(params.get("res") ?? 1);
const extraLights = Number(params.get("lights") ?? 0);

const bounce: BounceLightOptions | null =
  bounceStrength > 0
    ? {
        strength: bounceStrength,
        radius: 60,
        blend: params.get("blend") === "mix" ? "mix" : "max",
      }
    : null;

/** Small repeatable generator, so every setting gets the same crowd of lamps. */
let seed = 12345;
function random(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

/**
 * Sweeps the open strip between the pillar and the counter. The travel stays
 * clear of every piece of furniture, so the lamp itself never crosses a prop
 * and each shadow it throws has one obvious source.
 */
class Orbit extends Component {
  private readonly transform = this.sibling(Transform);
  private elapsed = 0;

  update(dt: number): void {
    this.elapsed += dt;
    this.transform.setPosition(
      400 + Math.cos(this.elapsed * 0.7) * 180,
      392 + Math.sin(this.elapsed * 1.1) * 22,
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
      `${rendererName} renderer  ·  probe (${x.toFixed(0)}, ${y.toFixed(0)})` +
        `  light ${level.toFixed(2)}`,
    );
  }
}

/** Sweeps a spotlight round the room, so its cone crosses every prop. */
class Sweep extends Component {
  private readonly transform = this.sibling(Transform);
  private elapsed = 0;

  update(dt: number): void {
    this.elapsed += dt;
    this.transform.setRotation(this.elapsed * 0.6);
  }
}

/** Carries one of the crowd of stress lamps round a small circle. */
class Drift extends Component {
  private readonly transform = this.sibling(Transform);
  private elapsed = random() * 10;

  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly reach: number,
  ) {
    super();
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.transform.setPosition(
      this.x + Math.cos(this.elapsed * 0.6) * this.reach,
      this.y + Math.sin(this.elapsed * 0.9) * this.reach,
    );
  }
}

class LightingScene extends Scene {
  readonly name = "lighting";
  readonly lighting = { renderer: rendererName, bounce };
  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: "markers", order: 10 },
    { name: "hud", order: 1000 },
  ];

  onEnter(): void {
    this.drawRoom();

    // The solid furniture blocks light, so the lamps below cast shadows and
    // the probe drops to the ambient level wherever a piece stands in the way.
    this.spawnOccluder("pillar", 400, 210, {
      type: "box",
      width: 70,
      height: 280,
    });
    this.spawnOccluder("counter", 400, 450, {
      type: "box",
      width: 200,
      height: 40,
    });
    this.spawnOccluder("planter", 155, 435, { type: "circle", radius: 42 });
    this.spawnOccluder("barrel", 645, 430, { type: "circle", radius: 48 });

    this.spawnLamp("warm-lamp", 220, 210, 190, 0xffa34d, 0.95);

    // A spotlight, so the cone and the softness of its edge are on screen
    // beside the shadows the same settings soften.
    const beam = this.spawnLamp("beam-lamp", 590, 205, 220, 0x66aaff, 0.85, {
      angle: Math.PI / 3,
      softness: coneSoftness,
    });
    beam.add(new Sweep());

    const orbiting = this.spawnLamp(
      "orbiting-lamp",
      580,
      392,
      140,
      0xff66b8,
      0.7,
    );
    orbiting.add(new Orbit());

    const palette = [0xffa34d, 0x66aaff, 0xff66b8, 0x8ce38c];
    // Dimmed as the crowd grows, so a roomful of lamps does not wash the
    // picture out at full brightness.
    const intensity = Math.min(0.6, Math.max(0.08, 6 / (extraLights || 1)));
    for (let index = 0; index < extraLights; index++) {
      const x = 60 + random() * 680;
      const y = 90 + random() * 420;
      const lamp = this.spawn(`crowd-lamp-${index}`);
      lamp.add(new Transform({ position: new Vec2(x, y) }));
      lamp.add(
        new LightSource({
          radius: 90 + random() * 60,
          intensity,
          color: palette[index % palette.length] ?? 0xffffff,
          size: lampSize,
        }),
      );
      lamp.add(new Drift(x, y, 20 + random() * 30));
    }

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

  private spawnOccluder(
    name: string,
    x: number,
    y: number,
    shape: LightOccluderShape,
  ): void {
    const entity = this.spawn(name);
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(new LightOccluder({ shape }));
  }

  private spawnLamp(
    name: string,
    x: number,
    y: number,
    radius: number,
    color: number,
    intensity: number,
    cone?: { angle: number; softness: number },
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
    lamp.add(
      new LightSource({
        radius,
        intensity,
        color,
        size: lampSize,
        ...(cone ? { cone } : {}),
      }),
    );
    return lamp;
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
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
      renderers: {
        soft: shaderLighting({ resolutionScale }),
        hard: overlayLighting({ resolutionScale }),
      },
      defaultRenderer: "soft",
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new LightingScene());
}

main().catch(console.error);
