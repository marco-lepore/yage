import {
  AssetHandle,
  Engine,
  LoadingScene,
  Scene,
  Transform,
  Vec2,
  type AssetLoader,
  type SceneTransition,
  type SceneTransitionContext,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  SceneRenderTreeProviderKey,
  crossFade,
  fade,
  flash,
} from "@yagejs/renderer";
import {
  Anchor,
  LoadingSceneProgressBar,
  UIPanel,
  UIPlugin,
} from "@yagejs/ui";
import type { Container } from "pixi.js";
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
  .row button:disabled { opacity: 0.4; cursor: not-allowed; }
  .slider-row { display: flex; gap: 0.5rem; align-items: center; justify-content: center; font-size: 0.85rem; }
  .slider-row input { flex: 1; max-width: 280px; }
  #status {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: #aaa;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 8px 12px;
    white-space: pre;
  }
`);

const WIDTH = 640;
const HEIGHT = 360;

// ----- Custom slideIn transition --------------------------------------------
// Slides the incoming scene's root container in from the right.
function slideIn(duration: number): SceneTransition {
  let toRoot: Container | undefined;
  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      if (!ctx.toScene) return;
      const provider = ctx.engineContext.resolve(SceneRenderTreeProviderKey);
      toRoot = provider.getTree(ctx.toScene)?.root;
      if (toRoot) toRoot.x = WIDTH;
    },
    tick(_dt, ctx) {
      if (!toRoot) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      toRoot.x = WIDTH * (1 - eased);
    },
    end() {
      if (toRoot) toRoot.x = 0;
      toRoot = undefined;
    },
  };
}

// ----- Scene base with label + background ----------------------------------
abstract class LabeledScene extends Scene {
  protected readonly color: number;
  protected readonly label: string;

  constructor(label: string, color: number) {
    super();
    this.label = label;
    this.color = color;
  }

  onEnter(): void {
    const bg = this.spawn("bg");
    bg.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    bg.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT).fill({
          color: this.color,
        });
      }),
    );

    // A large disc drawn from many rects spells out the label visually.
    const marker = this.spawn("marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 109).fill({ color: 0xffffff, alpha: 0.15 });
        g.circle(0, 0, 82).stroke({ color: 0xffffff, width: 4 });
      }),
    );

    const label = this.spawn("label");
    const panel = label.add(new UIPanel({ anchor: Anchor.Center }));
    panel.text(this.label, {
      fontSize: 64,
      fontWeight: "bold",
      fill: 0xffffff,
    });
  }
}

class MenuScene extends LabeledScene {
  readonly name = "menu";
  constructor() {
    super("MENU", 0x1e3a8a); // deep blue
  }
}

class LevelScene extends LabeledScene {
  readonly name = "level";
  // Demonstrate per-scene defaultTransition — pushing without a call-site
  // option still animates using this transition.
  override readonly defaultTransition = fade({
    duration: 400,
    color: 0x000000,
  });

  constructor() {
    super("LEVEL", 0x14532d); // deep green
  }
}

class GameOverScene extends LabeledScene {
  readonly name = "gameover";
  constructor() {
    super("OVER", 0x7f1d1d); // deep red
  }
}

// ----- Loading demo --------------------------------------------------------
// A tiny LoadingScene subclass that preloads a few synthetic "slow" assets
// before replacing itself with a target scene. Shows how LoadingScene
// composes with the transition system: the mount transition animates the
// loading screen in, and LoadingScene.transition animates the handoff out.

const slowLoader: AssetLoader<string> = {
  load: (path: string) =>
    new Promise((resolve) => {
      const delay = 150 + Math.random() * 350;
      setTimeout(() => resolve(`loaded:${path}`), delay);
    }),
};

function makeFakePreload(): AssetHandle<string>[] {
  const salt = Math.random().toString(36).slice(2, 6);
  return [
    new AssetHandle<string>("slow", `player-${salt}`),
    new AssetHandle<string>("slow", `world-${salt}`),
    new AssetHandle<string>("slow", `sfx-${salt}`),
    new AssetHandle<string>("slow", `music-${salt}`),
  ];
}

// A dedicated LabeledScene variant that declares the synthetic preload so
// LoadingScene has something to chew on during the demo.
class LoadedLevel extends LabeledScene {
  readonly name = "loaded";
  override readonly preload = makeFakePreload();
  constructor() {
    super("LOADED", 0x581c87); // purple
  }
}

class LoadThenShow extends LoadingScene {
  override readonly name = "loading";
  readonly target = () => new LoadedLevel();
  override readonly minDuration = 400;
  override readonly transition: SceneTransition;

  constructor(handoffMs: number) {
    super();
    this.transition = fade({ duration: handoffMs });
  }

  override onEnter(): void {
    this.spawn(LoadingSceneProgressBar, {
      backdrop: { color: 0x0b0f14, alpha: 1 },
      fill: { color: 0x38bdf8, alpha: 1 },
      track: { color: 0x1e293b, alpha: 1 },
    });
    this.startLoading();
  }
}

// ----- Boot ----------------------------------------------------------------
const engine = new Engine();
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x111111,
    container: setupGameContainer(WIDTH, HEIGHT),
  }),
);
engine.use(new UIPlugin());
await engine.start();
engine.assets.registerLoader("slow", slowLoader);
await engine.scenes.push(new MenuScene());

// ----- UI wiring -----------------------------------------------------------
const durationSlider = document.getElementById("duration") as HTMLInputElement;
const durationLabel = document.getElementById("duration-label") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;

function currentDuration(): number {
  return parseInt(durationSlider.value, 10);
}

durationSlider.addEventListener("input", () => {
  durationLabel.textContent = `${currentDuration()}ms`;
});
durationLabel.textContent = `${currentDuration()}ms`;

function nextScene(): LabeledScene {
  const current = engine.scenes.active?.name;
  if (current === "menu") return new LevelScene();
  if (current === "level") return new GameOverScene();
  return new MenuScene();
}

function bind(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener("click", fn);
}

bind("btn-push-fade", () => {
  void engine.scenes.push(nextScene(), {
    transition: fade({ duration: currentDuration() }),
  });
});

bind("btn-push-flash", () => {
  void engine.scenes.push(nextScene(), {
    transition: flash({ duration: currentDuration() }),
  });
});

bind("btn-push-crossfade", () => {
  void engine.scenes.push(nextScene(), {
    transition: crossFade({ duration: currentDuration() }),
  });
});

bind("btn-push-slide", () => {
  void engine.scenes.push(nextScene(), {
    transition: slideIn(currentDuration()),
  });
});

bind("btn-push-default", () => {
  // LevelScene has a defaultTransition — no call-site option needed.
  void engine.scenes.push(new LevelScene());
});

bind("btn-pop", () => {
  void engine.scenes.pop({ transition: fade({ duration: currentDuration() }) });
});

bind("btn-replace", () => {
  void engine.scenes.replace(nextScene(), {
    transition: fade({ duration: currentDuration() }),
  });
});

bind("btn-push-load", () => {
  // Replace the top scene with a loading screen that fades in via the
  // current duration, preloads synthetic "slow" assets, then fades to a
  // dedicated LoadedLevel. Demonstrates LoadingScene composing cleanly
  // with transitions on both ends — mount and handoff.
  void engine.scenes.replace(new LoadThenShow(currentDuration()), {
    transition: fade({ duration: currentDuration() }),
  });
});

bind("btn-clear", () => {
  void engine.scenes.popAll();
  void engine.scenes.push(new MenuScene());
});

// ----- Live status panel ---------------------------------------------------
function renderStatus(): void {
  const names = engine.scenes.all.map((s) => s.name).join(" → ") || "(empty)";
  const transitioning = engine.scenes.isTransitioning ? "yes" : "no";
  statusEl.textContent =
    `Stack:         ${names}\n` + `Transitioning: ${transitioning}`;
}

setInterval(renderStatus, 50);
renderStatus();
