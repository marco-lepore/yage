import { Component, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { control, defineScenario } from "@yagejs-tools/lab";
import { HEIGHT, WIDTH } from "../../lab/harness.js";

const PALETTE = {
  green: 0x22c55e,
  sky: 0x38bdf8,
  amber: 0xf59e0b,
} as const;

class Spin extends Component {
  private readonly transform = this.sibling(Transform);

  constructor(private readonly speed: number) {
    super();
  }

  update(dt: number): void {
    this.transform.rotate(this.speed * dt);
  }
}

export default defineScenario({
  title: "Basics / Spinning shapes",
  describe:
    "No physics. Drag a control and the scene rebuilds with the new value.",

  controls: {
    count: control.int(4, { min: 1, max: 16 }),
    speed: control.number(2, { min: -8, max: 8, step: 0.1, label: "spin rate" }),
    color: control.select("green", ["green", "sky", "amber"]),
    outline: control.boolean(true),
  },

  setup(scene, c) {
    for (let i = 0; i < c.count; i++) {
      const shape = scene.spawn(`shape-${i}`);
      const t = c.count === 1 ? 0.5 : i / (c.count - 1);
      shape.add(
        new Transform({
          position: new Vec2(80 + t * (WIDTH - 160), HEIGHT / 2),
        }),
      );
      shape.add(
        new GraphicsComponent().draw((g) => {
          const points = [0, -28, 28, 28, -28, 28];
          g.poly(points).fill({ color: PALETTE[c.color] });
          if (c.outline) {
            g.poly(points).stroke({ color: 0xf8fafc, width: 2 });
          }
        }),
      );
      shape.add(new Spin(c.speed));
    }
  },
});
