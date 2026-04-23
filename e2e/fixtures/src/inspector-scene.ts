import {
  Engine,
  Scene,
  SceneManagerKey,
  Component,
  Transform,
  Vec2,
} from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 640;
const HEIGHT = 360;
const container = setupContainer(WIDTH, HEIGHT);
const OVERLAY_PUSH_AFTER_FRAMES = 3;

class DelayedOverlayPush extends Component {
  private framesRemaining = OVERLAY_PUSH_AFTER_FRAMES;
  private pushed = false;

  update(): void {
    if (this.pushed) return;
    this.framesRemaining -= 1;
    if (this.framesRemaining > 0) return;
    this.pushed = true;
    const scenes = this.context.resolve(SceneManagerKey);
    void scenes.push(new OverlayScene());
  }
}

class OverlayScene extends Scene {
  readonly name = "overlay-scene";

  onEnter(): void {
    const marker = this.spawn("overlay-marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-40, -20, 80, 40).fill({ color: 0xf97316 });
      }),
    );
  }
}

class BaseScene extends Scene {
  readonly name = "base-scene";

  onEnter(): void {
    const marker = this.spawn("base-marker");
    marker.add(new Transform({ position: new Vec2(180, 180) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 28).fill({ color: 0x38bdf8 });
      }),
    );

    const controller = this.spawn("overlay-push-controller");
    controller.add(new DelayedOverlayPush());
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
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();
await engine.scenes.push(new BaseScene());
