import { Component, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { control, defineScenario } from "@yagejs-tools/lab";
import { HEIGHT, WIDTH } from "../../../lab/harness.js";

const PALETTE = {
  green: 0x22c55e,
  sky: 0x38bdf8,
  amber: 0xf59e0b,
} as const;

type Color = keyof typeof PALETTE;

class Spin extends Component {
  private readonly transform = this.sibling(Transform);

  constructor(private readonly speed: number) {
    super();
  }

  update(dt: number): void {
    this.transform.rotate(this.speed * dt);
  }
}

/** Shared by both scenarios in this file, which is why they live together. */
const shapeControls = {
  count: control.int(4, { min: 1, max: 16 }),
  color: control.select("green", ["green", "sky", "amber"]),
  outline: control.boolean(true),
};

function spawnRow(
  scene: Scene,
  c: { count: number; color: Color; outline: boolean },
): Entity[] {
  return Array.from({ length: c.count }, (_, i) => {
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
    return shape;
  });
}

export const still = defineScenario({
  describe:
    "No physics, nothing moving. Drag a control and the scene rebuilds.",
  controls: shapeControls,
  setup: spawnRow,
});

export const spinning = defineScenario({
  describe: "The same row, turning. Spin rate goes negative.",
  controls: {
    ...shapeControls,
    speed: control.number(2, {
      min: -8,
      max: 8,
      step: 0.1,
      label: "spin rate",
    }),
  },
  setup(scene, c) {
    for (const shape of spawnRow(scene, c)) shape.add(new Spin(c.speed));
  },
});
