import {
  AssetHandle,
  Engine,
  EventBusKey,
  LoadingScene,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { AssetLoader } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 640;
const HEIGHT = 360;
const container = setupContainer(WIDTH, HEIGHT);

// Controllable loader: each asset resolves/rejects when the test explicitly
// calls resolveAsset() / failAsset(). Lets the spec drive the full load
// lifecycle deterministically.
type Pending = { resolve: (v: string) => void; reject: (e: Error) => void };
const pending = new Map<string, Pending>();

const controllable: AssetLoader<string> = {
  load: (path) =>
    new Promise<string>((resolve, reject) => {
      pending.set(path, { resolve, reject });
    }),
};

const PRELOAD_PATHS = ["a", "b", "c"] as const;

class GameScene extends Scene {
  readonly name = "game-scene";
  override readonly preload = PRELOAD_PATHS.map(
    (p) => new AssetHandle<string>("ctrl", p),
  );

  onEnter(): void {
    const marker = this.spawn("game-marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-40, -40, 80, 80).fill({ color: 0x22c55e });
      }),
    );
  }
}

const progressEvents: number[] = [];
let doneEvents = 0;
const errors: string[] = [];

class Boot extends LoadingScene {
  override readonly name = "boot-scene";
  readonly target = () => new GameScene();

  override onEnter(): void {
    const marker = this.spawn("boot-marker");
    marker.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    marker.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 24).fill({ color: 0x38bdf8 });
      }),
    );
    this.startLoading();
  }

  override onLoadError(err: Error): void {
    errors.push(err.message);
    // Test drives the retry via __loadingTest__.retry() — don't auto-retry
    // here so the test can observe the failed state.
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();

engine.assets.registerLoader("ctrl", controllable);

const bus = engine.context.resolve(EventBusKey);
bus.on("scene:loading:progress", (ev) => {
  if (ev.scene instanceof Boot) progressEvents.push(ev.ratio);
});
bus.on("scene:loading:done", (ev) => {
  if (ev.scene instanceof Boot) doneEvents++;
});

let currentBoot: Boot | undefined;
function pushFreshBoot(): Promise<void> {
  currentBoot = new Boot();
  return engine.scenes.replace(currentBoot);
}
await pushFreshBoot();

(
  window as Window & {
    __loadingTest__?: {
      resolveAsset(path: string): boolean;
      failAsset(path: string, message: string): boolean;
      retry(): void;
      getProgressEvents(): number[];
      getDoneCount(): number;
      getErrors(): string[];
      reset(): Promise<void>;
    };
  }
).__loadingTest__ = {
  resolveAsset: (path) => {
    const p = pending.get(path);
    if (!p) return false;
    pending.delete(path);
    p.resolve(`loaded:${path}`);
    return true;
  },
  failAsset: (path, message) => {
    const p = pending.get(path);
    if (!p) return false;
    pending.delete(path);
    p.reject(new Error(message));
    return true;
  },
  retry: () => {
    currentBoot?.startLoading();
  },
  getProgressEvents: () => progressEvents.slice(),
  getDoneCount: () => doneEvents,
  getErrors: () => errors.slice(),
  reset: async () => {
    progressEvents.length = 0;
    doneEvents = 0;
    errors.length = 0;
    pending.clear();
    // Bust the AssetManager cache so a fresh push re-enters the load path
    // instead of hitting the cached values from the previous run.
    engine.assets.clear();
    await pushFreshBoot();
  },
};
