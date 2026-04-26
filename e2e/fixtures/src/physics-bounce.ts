import {
  Engine,
  Component,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { PhysicsPlugin, RigidBodyComponent, ColliderComponent } from "@yagejs/physics";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

class BounceCounter extends Component {
  count = 0;
  private readonly collider = this.sibling(ColliderComponent);

  onAdd(): void {
    this.collider.onCollision(({ other, started }) => {
      if (started && other.name === "floor") {
        this.count += 1;
      }
    });
  }
}

class PhysicsBounceScene extends Scene {
  readonly name = "physics-bounce";

  onEnter(): void {
    this.spawnFloor();
    this.spawnBall();
  }

  private spawnFloor(): void {
    const floor = this.spawn("floor");
    floor.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 20) }));
    floor.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-360, -20, 720, 40).fill({ color: 0x3f3f46 });
      }),
    );
    floor.add(new RigidBodyComponent({ type: "static" }));
    floor.add(
      new ColliderComponent({
        shape: { type: "box", width: 720, height: 40 },
        restitution: 0.95,
        friction: 0.2,
      }),
    );
  }

  private spawnBall(): void {
    const ball = this.spawn("ball");
    ball.add(new Transform({ position: new Vec2(WIDTH / 2, 120) }));
    ball.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 22).fill({ color: 0x22c55e });
      }),
    );
    ball.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
    ball.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 22 },
        restitution: 0.95,
        friction: 0.05,
        density: 1,
      }),
    );
    ball.add(new BounceCounter());
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container,
  }),
);
engine.use(new PhysicsPlugin());
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new PhysicsBounceScene());
