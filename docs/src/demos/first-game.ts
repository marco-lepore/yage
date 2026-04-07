import { Component, Transform, Vec2 } from "@yage/core";
import { GraphicsComponent } from "@yage/renderer";
import { createGame, defineInlineScene } from "yage";

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

export default async function (
  container: HTMLElement,
  opts: { width: number; height: number },
) {
  await createGame({
    width: opts.width,
    height: opts.height,
    backgroundColor: 0x0a0a0a,
    container,
    debug: true,
    scene: defineInlineScene("hello-world", (scene, { camera }) => {
      camera.position = new Vec2(opts.width / 2, opts.height / 2);

      const tri = scene.spawn("triangle");
      tri.add(new Transform({ position: new Vec2(opts.width / 2, opts.height / 2) }));
      tri.add(
        new GraphicsComponent().draw((g) => {
          g.poly([0, -45, 40, 35, -40, 35]).fill({ color: 0x22c55e });
        }),
      );
      tri.add(new Spin());
    }),
  });
}
