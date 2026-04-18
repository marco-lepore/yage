import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, RendererPlugin } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";

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

class HelloWorldScene extends Scene {
  readonly name = "hello-world";
  constructor(
    private w: number,
    private h: number,
  ) {
    super();
  }

  onEnter() {
    const tri = this.spawn("triangle");
    tri.add(new Transform({ position: new Vec2(this.w / 2, this.h / 2) }));
    tri.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -45, 40, 35, -40, 35]).fill({ color: 0x22c55e });
      }),
    );
    tri.add(new Spin());
  }
}

export default async function (
  container: HTMLElement,
  opts: { width: number; height: number },
) {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: opts.width,
      height: opts.height,
      backgroundColor: 0x0a0a0a,
      container,
    }),
  );
  engine.use(new DebugPlugin());
  await engine.start();
  engine.scenes.push(new HelloWorldScene(opts.width, opts.height));
}
