import { Engine, Component, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// Spin — rotates an entity at a constant rate
// ---------------------------------------------------------------------------
class Spin extends Component {
  private readonly transform = this.sibling(Transform);
  private speed: number;
  constructor(speed = 0.002) {
    super();
    this.speed = speed;
  }
  update(dt: number): void {
    this.transform.rotate(this.speed * dt);
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class HelloWorldScene extends Scene {
  readonly name = "hello-world";

  onEnter(): void {
    // Blue circle
    const circle = this.spawn("circle");
    circle.add(new Transform({ position: new Vec2(250, 300) }));
    circle.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 50).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 50).stroke({ color: 0x0ea5e9, width: 2 });
      }),
    );

    // Orange rectangle
    const rect = this.spawn("rect");
    rect.add(new Transform({ position: new Vec2(550, 300) }));
    rect.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-60, -40, 120, 80).fill({ color: 0xf97316 });
        g.rect(-60, -40, 120, 80).stroke({ color: 0xea580c, width: 2 });
      }),
    );

    // Green rotating triangle
    const tri = this.spawn("triangle");
    tri.add(new Transform({ position: new Vec2(400, 200) }));
    tri.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -45, 40, 35, -40, 35]).fill({ color: 0x22c55e });
        g.poly([0, -45, 40, 35, -40, 35]).stroke({ color: 0x16a34a, width: 2 });
      }),
    );
    tri.add(new Spin(0.002));

    // Small purple rotating diamond
    const diamond = this.spawn("diamond");
    diamond.add(new Transform({ position: new Vec2(400, 430) }));
    diamond.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -30, 25, 0, 0, 30, -25, 0]).fill({ color: 0xa78bfa });
        g.poly([0, -30, 25, 0, 0, 30, -25, 0]).stroke({
          color: 0x7c3aed,
          width: 2,
        });
      }),
    );
    diamond.add(new Spin(-0.003));
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
    container: setupGameContainer(800, 600),
  }));
  engine.use(new DebugPlugin());

  await engine.start();
  await engine.scenes.push(new HelloWorldScene());
}

main().catch(console.error);
