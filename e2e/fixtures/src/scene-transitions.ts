import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  SceneRenderTreeProviderKey,
  crossFade,
  fade,
  flash,
} from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles } from "./shared.js";

injectStyles();

const WIDTH = 640;
const HEIGHT = 360;

let sceneCounter = 0;

class ColorScene extends Scene {
  readonly name: string;
  private readonly color: number;

  constructor(name: string, color: number) {
    super();
    this.name = name;
    this.color = color;
  }

  onEnter(): void {
    const marker = this.spawn("marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-60, -30, 120, 60).fill({ color: this.color });
      }),
    );
  }
}

/** Scene with a per-scene defaultTransition. */
class DefaultTransitionScene extends Scene {
  readonly name = "default-scene";
  override readonly defaultTransition = fade({ duration: 200 });

  onEnter(): void {
    const marker = this.spawn("default-marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-60, -30, 120, 60).fill({ color: 0xa78bfa });
      }),
    );
  }
}

function nextName(): string {
  sceneCounter++;
  return `scene-${sceneCounter}`;
}

function nextColor(): number {
  const palette = [0x38bdf8, 0x22c55e, 0xf97316, 0xfb7185, 0xfacc15];
  return palette[sceneCounter % palette.length]!;
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container: document.getElementById("game-container") ?? document.body,
  }),
);
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();
await engine.scenes.push(new ColorScene("scene-a", 0x38bdf8));

type TransitionEvent = { type: "started" | "ended"; kind: string };
const transitionEvents: TransitionEvent[] = [];

engine.events.on("scene:transition:started", ({ kind }) => {
  transitionEvents.push({ type: "started", kind });
});
engine.events.on("scene:transition:ended", ({ kind }) => {
  transitionEvents.push({ type: "ended", kind });
});

let replaceEventCount = 0;
engine.events.on("scene:replaced", () => {
  replaceEventCount++;
});

type TransitionKind = "fade" | "flash" | "crossFade";

function makeTransition(kind: TransitionKind, duration: number) {
  switch (kind) {
    case "fade":
      return fade({ duration });
    case "flash":
      return flash({ duration });
    case "crossFade":
      return crossFade({ duration });
  }
}

interface SceneTransitionTestApi {
  pushWithTransition(kind: TransitionKind, duration: number): Promise<void>;
  popWithTransition(duration: number): Promise<void>;
  replaceWithTransition(duration: number): Promise<void>;
  pushWithDefault(): Promise<void>;
  getTransitionEvents(): TransitionEvent[];
  getReplaceEventCount(): number;
  resetEvents(): void;
  getIsTransitioning(): boolean;
  getStackNames(): string[];
  getSceneAlpha(sceneIndex: number): number | null;
  clearAll(): void;
}

(
  window as Window & { __sceneTransitionTest__?: SceneTransitionTestApi }
).__sceneTransitionTest__ = {
  pushWithTransition: (kind, duration) =>
    engine.scenes.push(new ColorScene(nextName(), nextColor()), {
      transition: makeTransition(kind, duration),
    }),
  popWithTransition: (duration) =>
    engine.scenes
      .pop({ transition: fade({ duration }) })
      .then(() => undefined),
  replaceWithTransition: (duration) =>
    engine.scenes.replace(new ColorScene(nextName(), nextColor()), {
      transition: fade({ duration }),
    }),
  pushWithDefault: () => engine.scenes.push(new DefaultTransitionScene()),
  getTransitionEvents: () => transitionEvents.slice(),
  getReplaceEventCount: () => replaceEventCount,
  resetEvents: () => {
    transitionEvents.length = 0;
    replaceEventCount = 0;
  },
  getIsTransitioning: () => engine.scenes.isTransitioning,
  getStackNames: () => engine.scenes.all.map((s) => s.name),
  getSceneAlpha: (sceneIndex: number): number | null => {
    const scene = engine.scenes.all[sceneIndex];
    if (!scene) return null;
    const provider = engine.context.resolve(SceneRenderTreeProviderKey);
    const tree = provider.getTree(scene);
    return tree ? tree.root.alpha : null;
  },
  clearAll: () => {
    // Fire-and-forget — popAll is queued. Awaiting would deadlock because
    // Playwright can't step frames while blocked inside evaluate().
    void engine.scenes.popAll();
  },
};
