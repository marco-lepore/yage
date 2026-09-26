/**
 * Hello World — the final code of the "Your First Game" tutorial
 * (docs/src/content/docs/getting-started/your-first-game.mdx): a `Spin`
 * component, a `Triangle` entity type, and a scene that spawns one.
 */
import {
  Component,
  Engine,
  Entity,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
} from "@yagejs/renderer";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Spin — rotates its entity at a constant rate, in radians per second
// ---------------------------------------------------------------------------
class Spin extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly speed: number;
  constructor(speed = 2) {
    super();
    this.speed = speed;
  }
  update(dt: number): void {
    this.transform.rotate(this.speed * dt);
  }
}

// ---------------------------------------------------------------------------
// Triangle — a green triangle that spins
// ---------------------------------------------------------------------------
class Triangle extends Entity {
  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -45, 40, 35, -40, 35]).fill({ color: 0x22c55e });
      }),
    );
    this.add(new Spin());
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class HelloWorldScene extends Scene {
  readonly name = "hello-world";

  onEnter(): void {
    this.spawn(CameraEntity, { position: new Vec2(400, 300) });
    this.spawn(Triangle, { position: new Vec2(400, 300) });
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
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(800, 600),
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new HelloWorldScene());
}

main().catch(console.error);
