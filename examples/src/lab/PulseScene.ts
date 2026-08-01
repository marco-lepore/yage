import { Component, Scene, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { HEIGHT, WIDTH } from "../../lab/harness.js";

/**
 * Scales its entity up and down. Neither field is a constructor parameter, so
 * a scenario can only reach them after the scene is on the stack — which is
 * what `onMounted` is for.
 */
export class Pulse extends Component {
  amplitude = 0.4;
  rate = 3;

  private readonly transform = this.sibling(Transform);
  private elapsed = 0;

  update(dt: number): void {
    this.elapsed += dt;
    const scale = 1 + Math.sin(this.elapsed * this.rate) * this.amplitude;
    this.transform.setScale(scale, scale);
  }
}

/** Stands in for a scene the game already has. */
export class PulseScene extends Scene {
  readonly name = "pulse";

  onEnter(): void {
    const disc = this.spawn("disc", { key: "disc" });
    disc.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    disc.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 60).fill({ color: 0xa78bfa });
      }),
    );
    disc.add(new Pulse());
  }
}
