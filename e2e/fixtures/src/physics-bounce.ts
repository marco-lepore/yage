import {
  CameraKey,
  ColliderComponent,
  Component,
  createGame,
  GraphicsComponent,
  RigidBodyComponent,
  Scene,
  Transform,
  Vec2,
} from "yage";
import { injectStyles } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;

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
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(WIDTH / 2, HEIGHT / 2);

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

await createGame({
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: 0x0a0a0a,
  physics: true,
  debug: { manualClock: true },
  scene: new PhysicsBounceScene(),
});
