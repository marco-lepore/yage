import {
  Scene,
  SceneManagerKey,
  Transform,
  Vec2,
  CameraKey,
  GraphicsComponent,
  createGame,
} from "yage";
import { injectStyles } from "./shared.js";

injectStyles();

const WIDTH = 640;
const HEIGHT = 360;
const OVERLAY_PUSH_DELAY_MS = 900;

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
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(WIDTH / 2, HEIGHT / 2);

    const marker = this.spawn("base-marker");
    marker.add(new Transform({ position: new Vec2(180, 180) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 28).fill({ color: 0x38bdf8 });
      }),
    );

    window.setTimeout(() => {
      const scenes = this.context.resolve(SceneManagerKey);
      void scenes.push(new OverlayScene());
    }, OVERLAY_PUSH_DELAY_MS);
  }
}

await createGame({
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: 0x0a0a0a,
  debug: true,
  scene: new BaseScene(),
});
