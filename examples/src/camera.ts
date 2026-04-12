import { Engine, Scene, Component, Transform, Vec2, ProcessComponent, createKeyframeTrack, easeInOutQuad } from "@yage/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraKey,
  RenderLayerManagerKey,
} from "@yage/renderer";
import { InputPlugin, InputManagerKey } from "@yage/input";
import { DebugPlugin } from "@yage/debug";
import { injectStyles, getContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// PlayerController — moves with WASD, triggers shake/zoom
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private speed = 0.25; // px per ms
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly camera = this.service(CameraKey);

  onAdd(): void {
    // Smooth follow with a deadzone so camera doesn't jitter on tiny movements
    this.camera.follow(this.transform, {
      smoothing: 0.15,
      deadzone: { halfWidth: 40, halfHeight: 30 },
    });
    this.camera.bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };
  }

  update(dt: number): void {
    const t = this.transform;
    const dir = this.input.getVector("left", "right", "up", "down");

    if (dir.x !== 0 || dir.y !== 0) {
      const move = dir.normalize().scale(this.speed * dt);
      t.translate(move.x, move.y);
    }

    // Rotate the player slowly
    t.rotate(0.002 * dt);

    // Shake on space
    if (this.input.isJustPressed("shake")) {
      this.camera.shake(6, 300, { decay: 0.8 });
    }

    // Zoom with Q / E
    if (this.input.isJustPressed("zoomIn")) {
      this.camera.zoomTo(Math.min(this.camera.zoom + 0.5, 3), 400);
    }
    if (this.input.isJustPressed("zoomOut")) {
      this.camera.zoomTo(Math.max(this.camera.zoom - 0.5, 0.5), 400);
    }
    if (this.input.isJustPressed("zoomReset")) {
      this.camera.zoomTo(1, 600);
    }
  }
}

// ---------------------------------------------------------------------------
// Demo scene
// ---------------------------------------------------------------------------
class CameraScene extends Scene {
  readonly name = "camera";

  private readonly layerMgr = this.service(RenderLayerManagerKey);

  onEnter(): void {
    this.layerMgr.create("bg", -10);
    this.layerMgr.create("world", 0);
    this.layerMgr.create("player", 10);

    // Grid background (2000x2000 world)
    this.drawGrid();

    // Scatter some landmarks
    this.spawnLandmarks();

    // Player
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(1000, 1000) }));
    player.add(
      new GraphicsComponent({ layer: "player" }).draw((g) => {
        // Arrow-shaped player
        g.poly([0, -18, 12, 14, 0, 8, -12, 14]).fill({ color: 0x00ffaa });
        // Small dot at center
        g.circle(0, 0, 3).fill({ color: 0xffffff });
      }),
    );
    player.add(new PlayerController());
  }

  private drawGrid(): void {
    const grid = this.spawn("grid");
    grid.add(new Transform());
    grid.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        // World boundary
        g.rect(0, 0, 2000, 2000).stroke({ color: 0x333333, width: 2 });
        // Grid lines every 200px
        for (let x = 0; x <= 2000; x += 200) {
          g.moveTo(x, 0).lineTo(x, 2000).stroke({ color: 0x1a1a1a, width: 1 });
        }
        for (let y = 0; y <= 2000; y += 200) {
          g.moveTo(0, y).lineTo(2000, y).stroke({ color: 0x1a1a1a, width: 1 });
        }
        // Origin crosshair
        g.circle(0, 0, 6).fill({ color: 0x444444 });
      }),
    );
  }

  private spawnLandmarks(): void {
    const rng = (min: number, max: number) => min + Math.random() * (max - min);

    // Colored circles scattered around the world
    const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa, 0xf97316, 0x38bdf8];
    for (let i = 0; i < 30; i++) {
      const x = rng(100, 1900);
      const y = rng(100, 1900);
      const color = colors[i % colors.length]!;
      const radius = rng(10, 30);

      const e = this.spawn(`landmark-${i}`);
      e.add(new Transform({ position: new Vec2(x, y) }));
      e.add(
        new GraphicsComponent({ layer: "world" }).draw((g) => {
          g.circle(0, 0, radius).fill({ color, alpha: 0.6 });
          g.circle(0, 0, radius).stroke({ color, width: 2, alpha: 0.9 });
        }),
      );
      const amplitude = rng(3, 12);
      const freq = rng(0.001, 0.004);
      const period = (2 * Math.PI) / freq;
      const origin = new Vec2(x, y);
      const transform = e.get(Transform);
      const pc = e.add(new ProcessComponent());
      pc.run(createKeyframeTrack({
        keyframes: [
          { time: 0, data: 0 },
          { time: period / 4, data: -amplitude },
          { time: period / 2, data: 0 },
          { time: period * 3 / 4, data: amplitude },
          { time: period, data: 0 },
        ],
        setter: (offsetY) => transform.setPosition(origin.x, origin.y + offsetY),
        loop: true,
        easing: easeInOutQuad,
      }));
    }

    // A few rectangular "buildings"
    for (let i = 0; i < 8; i++) {
      const x = rng(200, 1800);
      const y = rng(200, 1800);
      const w = rng(40, 100);
      const h = rng(40, 100);
      const color = colors[(i + 3) % colors.length]!;

      const e = this.spawn(`building-${i}`);
      e.add(new Transform({ position: new Vec2(x, y) }));
      e.add(
        new GraphicsComponent({ layer: "world" }).draw((g) => {
          g.rect(-w / 2, -h / 2, w, h).fill({ color, alpha: 0.3 });
          g.rect(-w / 2, -h / 2, w, h).stroke({ color, width: 1.5 });
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(new RendererPlugin({
    width: 800,
    height: 600,
    backgroundColor: 0x0a0a0a,
    container: getContainer(),
  }));
  engine.use(new InputPlugin({
    actions: {
      up: ["KeyW", "ArrowUp"],
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      shake: ["Space"],
      zoomIn: ["KeyQ"],
      zoomOut: ["KeyE"],
      zoomReset: ["KeyR"],
    },
    preventDefaultKeys: ["Space"],
  }));
  engine.use(new DebugPlugin());

  await engine.start();
  engine.scenes.push(new CameraScene());
}

main().catch(console.error);
