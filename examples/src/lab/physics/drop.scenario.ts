import { Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { control, defineScenario } from "@yagejs-tools/lab";
import { HEIGHT, WIDTH } from "../../../lab/harness.js";

const FLOOR_HEIGHT = 24;
const FLOOR_Y = HEIGHT - 60;
const FLOOR_TOP = FLOOR_Y - FLOOR_HEIGHT / 2;

export default defineScenario({
  describe: "Rapier bodies falling onto a floor. Raise bounce and watch again.",

  controls: {
    count: control.int(3, { min: 1, max: 12, label: "balls" }),
    // 12 balls of this radius still clear each other in a row 640px wide.
    // Wider and they spawn intersecting, and Rapier pushes them apart hard
    // enough to shove the outer ones off the floor.
    radius: control.int(16, { min: 6, max: 24 }),
    bounce: control.number(0.6, { min: 0, max: 0.95, step: 0.05 }),
  },

  setup(scene, c) {
    const floor = scene.spawn("floor");
    floor.add(new Transform({ position: new Vec2(WIDTH / 2, FLOOR_Y) }));
    floor.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-WIDTH / 2, -FLOOR_HEIGHT / 2, WIDTH, FLOOR_HEIGHT).fill({
          color: 0x334155,
        });
      }),
    );
    floor.add(new RigidBodyComponent({ type: "static" }));
    floor.add(
      new ColliderComponent({
        shape: { type: "box", width: WIDTH, height: FLOOR_HEIGHT },
      }),
    );

    const spacing = WIDTH / (c.count + 1);
    for (let i = 0; i < c.count; i++) {
      // The key is what `drive` looks a ball up by.
      const ball = scene.spawn(`ball-${i}`, { key: `ball-${i}` });
      // Position goes in the Transform before RigidBodyComponent is added: the
      // Rapier body is created from the Transform at that moment, and a later
      // `setPosition` on the Transform is snapped back by the next step.
      ball.add(new Transform({ position: new Vec2(spacing * (i + 1), 60) }));
      ball.add(
        new GraphicsComponent().draw((g) => {
          g.circle(0, 0, c.radius).fill({ color: 0x38bdf8 });
        }),
      );
      ball.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
      ball.add(
        new ColliderComponent({
          shape: { type: "circle", radius: c.radius },
          restitution: c.bounce,
          friction: 0.3,
          density: 1,
        }),
      );
    }
  },

  async drive({ scene, step, expect }) {
    const ball = scene.findByKey("ball-0");
    if (!ball) throw new Error("the scenario spawned no ball-0");
    const transform = ball.get(Transform);
    const startY = transform.position.y;

    // Two seconds of gravity, issued frame by frame rather than waited for.
    await step(120);

    expect(transform.position.y).toBeGreaterThan(startY);
    // Its centre stayed above the floor's top face, so it landed on the floor
    // rather than passing through it.
    expect(transform.position.y).toBeLessThan(FLOOR_TOP);
  },
});
