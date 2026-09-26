import {
  Engine,
  Scene,
  Component,
  Entity,
  ProcessComponent,
  RandomKey,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { setupGameContainer } from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;
const WALL = 20;
const MAX_SHAPES = 50;
const SPAWN_INTERVAL = 0.5; // seconds

// ---------------------------------------------------------------------------
// ShapeSpawner — spawns a shape every 0.5 s and five more on Space, up to 50
// in total
// ---------------------------------------------------------------------------
class ShapeSpawner extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly rng = this.service(RandomKey);
  private readonly processes = this.sibling(ProcessComponent);
  /** Running until the next automatic spawn is due. */
  private spawnInterval!: ProcessSlot;
  private shapeCount = 0;

  onAdd(): void {
    this.spawnInterval = this.processes
      .slot({ duration: SPAWN_INTERVAL })
      .start();
  }

  update(): void {
    const scene = this.scene;

    if (!this.spawnInterval.running && this.shapeCount < MAX_SHAPES) {
      this.spawnInterval.restart();
      this.spawnShape(scene);
    }

    // Space — burst 5 shapes
    if (this.input.isJustPressed("spawn")) {
      for (let i = 0; i < 5 && this.shapeCount < MAX_SHAPES; i++) {
        this.spawnShape(scene);
      }
    }
  }

  private spawnShape(scene: Scene): void {
    this.shapeCount++;
    const isCircle = this.rng.float() > 0.5;
    const x = this.rng.range(100, WIDTH - 100);
    const restitution = this.rng.range(0.1, 0.9);
    const color = this.rng.pick(PALETTE);
    const shape: ShapeSpec = isCircle
      ? { type: "circle", radius: this.rng.range(12, 30) }
      : {
          type: "box",
          width: this.rng.range(10, 30) * 2,
          height: this.rng.range(10, 30) * 2,
        };
    scene.spawn(ShapeEntity, { x, color, restitution, shape });
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
/** A falling shape's collider; its fill is drawn to the same outline. */
type ShapeSpec =
  | { type: "circle"; radius: number }
  | { type: "box"; width: number; height: number };

/** A dynamic circle or box dropped from the top of the arena. */
class ShapeEntity extends Entity {
  setup(params: {
    x: number;
    color: number;
    restitution: number;
    shape: ShapeSpec;
  }): void {
    const { x, color, restitution, shape } = params;
    this.add(new Transform({ position: new Vec2(x, 40) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        if (shape.type === "circle") {
          g.circle(0, 0, shape.radius).fill({ color, alpha: 0.85 });
        } else {
          const { width: w, height: h } = shape;
          g.rect(-w / 2, -h / 2, w, h).fill({ color, alpha: 0.85 });
        }
      }),
    );
    this.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
    this.add(
      new ColliderComponent({
        shape,
        restitution,
        friction: 0.3,
        density: 1,
      }),
    );
  }
}

/** A static wall around the arena. */
class WallEntity extends Entity {
  setup(params: {
    x: number;
    y: number;
    w: number;
    h: number;
    color: number;
  }): void {
    const { x, y, w, h, color } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        restitution: 0.3,
        friction: 0.5,
      }),
    );
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
    ctrl.add(new ProcessComponent());
    ctrl.add(new ShapeSpawner());

    // Walls (static — gray debug outlines)
    const walls = [
      {
        x: WIDTH / 2,
        y: HEIGHT - WALL / 2,
        w: WIDTH,
        h: WALL,
        color: 0x444444,
      },
      { x: WIDTH / 2, y: WALL / 2, w: WIDTH, h: WALL, color: 0x333333 },
      { x: WALL / 2, y: HEIGHT / 2, w: WALL, h: HEIGHT, color: 0x333333 },
      {
        x: WIDTH - WALL / 2,
        y: HEIGHT / 2,
        w: WALL,
        h: HEIGHT,
        color: 0x333333,
      },
    ];
    for (const wall of walls) this.spawn(WallEntity, wall);

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PALETTE = [
  0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa, 0xf97316, 0x38bdf8, 0xfb7185,
  0x34d399,
];

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
