import {
  Engine,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles } from "./shared.js";

injectStyles();

const WIDTH = 640;
const HEIGHT = 360;

class OverlayScene extends Scene {
  readonly name = "overlay-scene";

  onEnter(): void {
    const marker = this.spawn("overlay-marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-50, -24, 100, 48).fill({ color: 0xf97316 });
      }),
    );
  }
}

class ReplacementScene extends Scene {
  readonly name = "replacement-scene";

  onEnter(): void {
    const marker = this.spawn("replacement-marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-60, -30, 120, 60).fill({ color: 0x22c55e });
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
  }
}

const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: WIDTH, height: HEIGHT, backgroundColor: 0x0a0a0a, resolution: 1, container: document.getElementById("game-container") ?? document.body }));
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();
await engine.scenes.push(new BaseScene());

(window as Window & {
  __sceneStackTest__?: {
    pushOverlay(): Promise<void>;
    popTop(): void;
    replaceWithReplacement(): Promise<void>;
  };
}).__sceneStackTest__ = {
  pushOverlay: () => engine.scenes.push(new OverlayScene()),
  popTop: () => {
    engine.scenes.pop();
  },
  replaceWithReplacement: () => engine.scenes.replace(new ReplacementScene()),
};
