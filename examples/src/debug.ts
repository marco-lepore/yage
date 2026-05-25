import { Engine, Scene, Component, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const WALL = 20;

// ---------------------------------------------------------------------------
// ShapeSpawner — auto-spawns shapes, Space to burst, F for impulse
// ---------------------------------------------------------------------------
class ShapeSpawner extends Component {
  private readonly input = this.service(InputManagerKey);
  private shapeCount = 0;
  private spawnTimer = 0;

  update(dt: number): void {
    const scene = this.scene;

    // Auto-spawn a shape every 500ms (up to 50)
    this.spawnTimer += dt;
    if (this.spawnTimer > 500 && this.shapeCount < 50) {
      this.spawnTimer = 0;
      this.spawnShape(scene);
    }

    // Space — burst 5 shapes
    if (this.input.isJustPressed("spawn")) {
      for (let i = 0; i < 5 && this.shapeCount < 50; i++) {
        this.spawnShape(scene);
      }
    }
  }

  private spawnShape(scene: Scene): void {
    this.shapeCount++;
    const isCircle = Math.random() > 0.5;
    const x = 100 + Math.random() * (WIDTH - 200);
    const restitution = 0.1 + Math.random() * 0.8;
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]!;

    const e = scene.spawn(`shape-${this.shapeCount}`);
    e.add(new Transform({ position: new Vec2(x, 40) }));

    if (isCircle) {
      const radius = 12 + Math.random() * 18;
      e.add(
        new GraphicsComponent().draw((g) => {
          g.circle(0, 0, radius).fill({ color, alpha: 0.85 });
        }),
      );
      e.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
      e.add(
        new ColliderComponent({
          shape: { type: "circle", radius },
          restitution,
          friction: 0.3,
          density: 1,
        }),
      );
    } else {
      const hw = 10 + Math.random() * 20;
      const hh = 10 + Math.random() * 20;
      e.add(
        new GraphicsComponent().draw((g) => {
          g.rect(-hw, -hh, hw * 2, hh * 2).fill({ color, alpha: 0.85 });
        }),
      );
      e.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
      e.add(
        new ColliderComponent({
          shape: { type: "box", width: hw * 2, height: hh * 2 },
          restitution,
          friction: 0.3,
          density: 1,
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class DebugDemoScene extends Scene {
  readonly name = "debug-demo";

  onEnter(): void {
    // Spawner entity
    const ctrl = this.spawn("spawner");
    ctrl.add(new Transform());
    ctrl.add(new ShapeSpawner());

    // Walls (static — gray debug outlines)
    this.createWall(WIDTH / 2, HEIGHT - WALL / 2, WIDTH, WALL, 0x444444);
    this.createWall(WIDTH / 2, WALL / 2, WIDTH, WALL, 0x333333);
    this.createWall(WALL / 2, HEIGHT / 2, WALL, HEIGHT, 0x333333);
    this.createWall(WIDTH - WALL / 2, HEIGHT / 2, WALL, HEIGHT, 0x333333);

    // Kinematic platform (blue debug outline)
    const plat = this.spawn("platform");
    plat.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 120) }));
    plat.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-80, -8, 160, 16).fill({ color: 0x666666 });
      }),
    );
    plat.add(new RigidBodyComponent({ type: "kinematic" }));
    plat.add(
      new ColliderComponent({
        shape: { type: "box", width: 160, height: 16 },
      }),
    );

    // Sensor zone (yellow debug outline)
    const sensor = this.spawn("sensor-zone");
    sensor.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    sensor.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-50, -50, 100, 100).fill({ color: 0xffff00, alpha: 0.05 });
      }),
    );
    sensor.add(new RigidBodyComponent({ type: "static" }));
    sensor.add(
      new ColliderComponent({
        shape: { type: "box", width: 100, height: 100 },
        sensor: true,
      }),
    );
  }

  private createWall(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
  ): void {
    const e = this.spawn("wall");
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color });
      }),
    );
    e.add(new RigidBodyComponent({ type: "static" }));
    e.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        restitution: 0.3,
        friction: 0.5,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PALETTE = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa, 0xf97316, 0x38bdf8, 0xfb7185, 0x34d399];

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      virtualWidth: WIDTH,
      virtualHeight: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        spawn: ["Space"],
      },
    }),
  );
  engine.use(new DebugPlugin({ startEnabled: true }));

  await engine.start();
  await engine.scenes.push(new DebugDemoScene());
}

main().catch(console.error);
