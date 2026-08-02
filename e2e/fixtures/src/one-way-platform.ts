/**
 * One-way platform fixture: a `oneWay` platform, a rider dropped onto it
 * from above, and a jumper launched up through it from below. Exposes
 * `window.__oneWay__.dropThrough()` so the spec decides when the rider
 * falls through. Runs the contact-filter hook in the browser's ESM Rapier
 * build — the path games actually ship.
 */
import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

class OneWayScene extends Scene {
  readonly name = "one-way-platform";

  onEnter(): void {
    const platform = this.spawn("platform");
    platform.add(new Transform({ position: new Vec2(WIDTH / 2, 400) }));
    platform.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-150, -10, 300, 20).fill({ color: 0xf59e0b });
      }),
    );
    platform.add(new RigidBodyComponent({ type: "static" }));
    platform.add(
      new ColliderComponent({
        shape: { type: "box", width: 300, height: 20 },
        oneWay: {},
      }),
    );

    const rider = this.spawn("rider");
    rider.add(new Transform({ position: new Vec2(WIDTH / 2, 100) }));
    rider.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-12, -12, 24, 24).fill({ color: 0x22c55e });
      }),
    );
    rider.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    const riderCollider = rider.add(
      new ColliderComponent({ shape: { type: "box", width: 24, height: 24 } }),
    );

    const jumper = this.spawn("jumper");
    jumper.add(new Transform({ position: new Vec2(WIDTH / 2 + 100, 560) }));
    jumper.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-12, -12, 24, 24).fill({ color: 0x38bdf8 });
      }),
    );
    const jumperBody = jumper.add(
      new RigidBodyComponent({ type: "dynamic", fixedRotation: true }),
    );
    jumper.add(
      new ColliderComponent({ shape: { type: "box", width: 24, height: 24 } }),
    );
    jumperBody.setVelocity({ x: 0, y: -1000 });

    (window as unknown as { __oneWay__: { dropThrough: () => void } }).__oneWay__ =
      {
        dropThrough: () => riderCollider.dropThrough(0.3),
      };
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
await engine.scenes.push(new OneWayScene());
