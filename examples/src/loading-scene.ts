import {
  AssetHandle,
  Component,
  Engine,
  Entity,
  EventBusKey,
  LoadingScene,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { AssetLoader } from "@yagejs/core";
import { fade, GraphicsComponent, RendererPlugin } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  Anchor,
  LoadingSceneProgressBar,
  UIPanel,
  UIPlugin,
} from "@yagejs/ui";
import { setupGameContainer, injectStyles } from "./shared.js";

injectStyles(`
  .controls { flex-direction: column; gap: 0.5rem; align-items: stretch; max-width: 640px; width: 100%; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; }
  .row button {
    background: #1d4ed8;
    border: 1px solid #2563eb;
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .row button:hover { background: #2563eb; }
  .explain {
    font-size: 0.85rem;
    color: #999;
    line-height: 1.5;
    max-width: 640px;
    text-align: center;
  }
  code { background: #222; padding: 2px 6px; border-radius: 3px; }
`);

const WIDTH = 640;
const HEIGHT = 360;

// ---------------------------------------------------------------------------
// Synthetic "slow asset" type so the progress bar is visible on every run.
// Each entry resolves after a randomised delay.
// ---------------------------------------------------------------------------
const slowLoader: AssetLoader<string> = {
  load: (path: string) =>
    new Promise((resolve) => {
      const delay = 250 + Math.random() * 600;
      setTimeout(() => resolve(`loaded:${path}`), delay);
    }),
};

function slowAsset(name: string): AssetHandle<string> {
  return new AssetHandle<string>("slow", name);
}

const PRELOAD = [
  slowAsset("player"),
  slowAsset("enemies"),
  slowAsset("level-1"),
  slowAsset("level-2"),
  slowAsset("music"),
  slowAsset("sfx"),
  slowAsset("ui-sprites"),
  slowAsset("particles"),
];

// ---------------------------------------------------------------------------
// Target scene — the "real game". Pretends to depend on heavy assets. Draws
// a welcome screen on enter so you can see the handoff happened.
// ---------------------------------------------------------------------------
class GameScene extends Scene {
  readonly name = "game";
  override readonly preload = PRELOAD;

  onEnter(): void {
    const bg = this.spawn("bg");
    bg.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    bg.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT).fill({
          color: 0x14532d,
        });
      }),
    );

    const title = this.spawn("title");
    title.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    title.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 80).fill({ color: 0xffffff, alpha: 0.1 });
        g.circle(0, 0, 80).stroke({ color: 0xffffff, width: 4 });
        g.rect(-40, -6, 80, 12).fill({ color: 0xffffff });
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Boot scenes — two variants showing the shape of the LoadingScene API.
//
// AutoBoot: the default. Hand off as soon as assets + minDuration are done.
// PressAnyKeyBoot: autoContinue=false + a component that listens to the
// `scene:loading:done` event and waits for a keypress to call continue().
// ---------------------------------------------------------------------------
class AutoBoot extends LoadingScene {
  override readonly name = "boot";
  readonly target = () => new GameScene();
  override readonly minDuration = 500;
  override readonly transition = fade({ duration: 300 });

  override onEnter(): void {
    this.spawn(LoadingSceneProgressBar, {
      backdrop: { color: 0x0b0f14, alpha: 1 },
    });
    this.startLoading();
  }
}

class PressAnyKeyBoot extends LoadingScene {
  override readonly name = "boot-pak";
  readonly target = () => new GameScene();
  override readonly autoContinue = false;
  override readonly transition = fade({ duration: 300 });

  override onEnter(): void {
    this.spawn(LoadingSceneProgressBar, {
      backdrop: { color: 0x0b0f14, alpha: 1 },
    });
    this.spawn(PressAnyKeyPrompt);
    this.startLoading();
  }
}

// ---------------------------------------------------------------------------
// PressAnyKeyPrompt — Entity that, once `scene:loading:done` fires, shows a
// "Press space to continue" label and calls `scene.continue()` on input.
// ---------------------------------------------------------------------------
class PressAnyKeyPrompt extends Entity {
  setup(): void {
    this.add(new PressAnyKeyLogic());
  }
}

class PressAnyKeyLogic extends Component {
  private readonly input = this.service(InputManagerKey);
  private ready = false;
  private unsub?: () => void;

  override onAdd(): void {
    const scene = this.scene;
    const bus = scene.context.resolve(EventBusKey);
    this.unsub = bus.on("scene:loading:done", (ev) => {
      if (ev.scene !== scene) return;
      this.showPromptLabel();
      this.ready = true;
    });
  }

  override onDestroy(): void {
    this.unsub?.();
  }

  update(): void {
    if (!this.ready) return;
    if (this.input.isJustPressed("continue")) {
      this.ready = false;
      const scene = this.scene;
      if (scene instanceof LoadingScene) scene.continue();
    }
  }

  private showPromptLabel(): void {
    const labelEntity = this.scene.spawn("press-any-key-label");
    const panel = labelEntity.add(
      new UIPanel({
        anchor: Anchor.BottomCenter,
        offset: { x: 0, y: -40 },
      }),
    );
    panel.text("Press space to continue", {
      fontFamily: "sans-serif",
      fontSize: 18,
      fill: 0xffffff,
    });
  }
}

// ---------------------------------------------------------------------------
// Boot the engine.
// ---------------------------------------------------------------------------
const engine = new Engine();
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0b0f14,
    container: setupGameContainer(WIDTH, HEIGHT),
  }),
);
engine.use(
  new InputPlugin({
    actions: { continue: ["Space", "Enter"] },
    preventDefaultKeys: ["Space"],
  }),
);
engine.use(new UIPlugin());
await engine.start();
engine.assets.registerLoader("slow", slowLoader);

await engine.scenes.push(new AutoBoot());

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
document.getElementById("btn-auto")?.addEventListener("click", () => {
  void engine.scenes.replace(new AutoBoot());
});

document.getElementById("btn-press-any-key")?.addEventListener("click", () => {
  void engine.scenes.replace(new PressAnyKeyBoot());
});

document.getElementById("btn-uncache")?.addEventListener("click", () => {
  const salt = Math.random().toString(36).slice(2, 6);
  class ReloadedGameScene extends GameScene {
    override readonly preload = PRELOAD.map((h) => slowAsset(`${h.path}-${salt}`));
  }
  class ReloadBoot extends AutoBoot {
    override readonly target = () => new ReloadedGameScene();
  }
  void engine.scenes.replace(new ReloadBoot());
});
