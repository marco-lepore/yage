import { Component, Transform, Vec2 } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { GraphicsComponent } from "@yagejs/renderer";
import { control, defineScenario } from "@yagejs-tools/lab";
import { HEIGHT, WIDTH } from "../../lab/harness.js";

const SIZE = 48;
const REST_Y = HEIGHT - 80;
const CEILING_Y = 80;

/**
 * Rises while the `jump` action is held and sinks back when it is not. The
 * three edge flags are read every frame so the drive can assert on them.
 */
class Hover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  pressed = false;
  justPressed = false;
  justReleased = false;

  constructor(
    private readonly rise: number,
    private readonly fall: number,
  ) {
    super();
  }

  update(dt: number): void {
    this.pressed = this.input.isPressed("jump");
    this.justPressed = this.input.isJustPressed("jump");
    this.justReleased = this.input.isJustReleased("jump");

    const speed = this.pressed ? -this.rise : this.fall;
    const y = this.transform.position.y + speed * dt;
    this.transform.setPosition(
      this.transform.position.x,
      Math.min(REST_Y, Math.max(CEILING_Y, y)),
    );
  }
}

export default defineScenario({
  title: "Input / Hold to hover",
  describe:
    "Hold Space to lift the block. Run the drive to press it across exact frames.",

  controls: {
    rise: control.number(420, { min: 60, max: 900, step: 20 }),
    fall: control.number(240, { min: 60, max: 900, step: 20 }),
  },

  setup(scene, c) {
    const block = scene.spawn("block", { key: "block" });
    block.add(new Transform({ position: new Vec2(WIDTH / 2, REST_Y) }));
    block.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-SIZE / 2, -SIZE / 2, SIZE, SIZE).fill({ color: 0xfbbf24 });
      }),
    );
    block.add(new Hover(c.rise, c.fall));
  },

  async drive({ scene, input, step, expect }) {
    const block = scene.findByKey("block");
    if (!block) throw new Error("the scenario spawned no block");
    const hover = block.get(Hover);
    const transform = block.get(Transform);
    const restY = transform.position.y;

    expect(hover.pressed).toBe(false);

    // The press is only visible to the game once a frame has run.
    input.keyDown("Space");
    await step(1);
    expect(hover.pressed).toBe(true);
    expect(hover.justPressed).toBe(true);

    await step(1);
    expect(hover.justPressed).toBe(false);
    expect(hover.pressed).toBe(true);

    await step(28);
    expect(transform.position.y).toBeLessThan(restY);

    input.keyUp("Space");
    await step(1);
    expect(hover.pressed).toBe(false);
    expect(hover.justReleased).toBe(true);

    // Long enough to fall the whole way back, whatever `fall` is set to.
    await step(180);
    expect(transform.position.y).toBe(restY);
  },
});
