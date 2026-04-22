import {
  AssetManagerKey,
  GameLoopKey,
  SceneHookRegistryKey,
  Vec2,
} from "@yagejs/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { Application, Assets, Graphics } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { FitController } from "./Fit.js";
import type { GraphicsContext, TextureResource } from "./public-types.js";
import { RendererKey } from "./types.js";
import type { RendererConfig, RendererFitOptions } from "./types.js";
import type { SceneRenderTreeProvider } from "./SceneRenderTree.js";
import {
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "./SceneRenderTree.js";
import { SceneRenderTreeProviderImpl } from "./SceneRenderTreeProvider.js";

import "./scene-augmentation.js";

/** RendererPlugin wraps PixiJS v8 behind the YAGE plugin interface. */
export class RendererPlugin implements Plugin {
  readonly name = "renderer";
  readonly version = "4.0.0";

  private app!: Application;
  private readonly config: RendererConfig;
  private readonly virtualWidth: number;
  private readonly virtualHeight: number;
  private provider!: SceneRenderTreeProviderImpl;
  private tickerFn: (() => void) | null = null;
  private unregisterHooks: (() => void) | null = null;
  private fitController!: FitController;

  constructor(config: RendererConfig) {
    this.config = config;
    this.virtualWidth = config.virtualWidth ?? config.width;
    this.virtualHeight = config.virtualHeight ?? config.height;
  }

  async install(context: EngineContext): Promise<void> {
    // 1. Create & init PixiJS Application
    this.app = new Application();
    const resolution =
      this.config.resolution ??
      (typeof window !== "undefined" ? window.devicePixelRatio : 1);
    await this.app.init({
      width: this.config.width,
      height: this.config.height,
      backgroundColor: this.config.backgroundColor ?? 0x000000,
      resolution,
      autoDensity: true,
      ...this.config.pixi,
      ...(this.config.canvas ? { canvas: this.config.canvas } : undefined),
    });

    // 2. Append canvas to container if specified
    if (this.config.container) {
      this.config.container.appendChild(this.app.canvas);
    }

    // 3. FitController always owns the stage transform. When `fit` is
    //    configured (or defaulted), it observes a host element and re-maps
    //    the virtual rectangle on each resize. In environments without a
    //    DOM target (tests, headless), it applies the transform once against
    //    the initial `width × height` and installs no observer.
    this.startFit(this.config.fit ?? { mode: "letterbox" });

    // 4. Create the per-scene render tree provider.
    //    Each scene gets one root container as a direct child of app.stage.
    this.provider = new SceneRenderTreeProviderImpl(this.app.stage);

    // 5. Register services
    context.register(RendererKey, this);
    context.register(SceneRenderTreeProviderKey, this.provider);

    // 6. Register scene hooks: materialize a tree per scene on enter,
    //    tear it down on exit.
    const hookRegistry = context.resolve(SceneHookRegistryKey);
    this.unregisterHooks = hookRegistry.register({
      beforeEnter: (scene) => {
        const tree = this.provider.createForScene(scene);
        scene._registerScoped(SceneRenderTreeKey, tree);
      },
      afterExit: (scene) => {
        this.provider.destroyForScene(scene);
      },
    });

    // 7. Attach PixiJS ticker to GameLoop
    const gameLoop = context.resolve(GameLoopKey);
    gameLoop.attachTicker((callback) => {
      const fn = () => callback(this.app.ticker.deltaMS);
      this.tickerFn = fn;
      this.app.ticker.add(fn);
      return () => this.app.ticker.remove(fn);
    });

    // 8. Register asset loaders (if AssetManager is available)
    const am = context.tryResolve(AssetManagerKey);
    am?.registerLoader("texture", {
      load: (path: string) => Assets.load<TextureResource>(path),
      unload: (path: string) => {
        Assets.unload(path);
      },
    });
    am?.registerLoader("render-asset", {
      load: (path: string) => Assets.load(path),
      unload: (path: string) => {
        Assets.unload(path);
      },
    });
    am?.registerLoader("spritesheet", {
      load: (path: string) => Assets.load<Spritesheet>(path),
      unload: (path: string) => {
        Assets.unload(path);
      },
    });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new DisplaySystem());
  }

  onDestroy(): void {
    this.unregisterHooks?.();
    this.unregisterHooks = null;
    this.fitController.stop();
    if (this.tickerFn) {
      this.app.ticker.remove(this.tickerFn);
      this.tickerFn = null;
    }
    this.provider.destroyAll();
    this.app.destroy();
  }

  /** The PixiJS Application instance. */
  get application(): Application {
    return this.app;
  }

  /** The canvas element. */
  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  /** Virtual resolution size. */
  get virtualSize(): { width: number; height: number } {
    return { width: this.virtualWidth, height: this.virtualHeight };
  }

  /** Current canvas size in CSS pixels. Changes on host resize under responsive fit. */
  get canvasSize(): { width: number; height: number } {
    return this.fitController.canvasSize;
  }

  /** Current fit configuration. */
  get fit(): RendererFitOptions {
    const target = this.fitController.currentTarget;
    return {
      mode: this.fitController.currentMode,
      ...(target ? { target } : {}),
    };
  }

  /** Change the fit mode and/or target at runtime. */
  setFit(options: RendererFitOptions): void {
    this.startFit(options);
  }

  /**
   * Convert CSS pixels relative to the canvas top-left into virtual-space
   * pixels. Inverts the stage transform currently applied by the fit controller.
   */
  canvasToVirtual(x: number, y: number): Vec2 {
    return this.fitController.canvasToVirtual(x, y);
  }

  /** The per-scene render tree provider. */
  get sceneRenderTrees(): SceneRenderTreeProvider {
    return this.provider;
  }

  /** Create a texture by drawing into a temporary graphics context. */
  createTexture(draw: (graphics: GraphicsContext) => void): TextureResource {
    const graphics = new Graphics();
    try {
      draw(graphics);
      return this.app.renderer.generateTexture(graphics);
    } finally {
      graphics.destroy();
    }
  }

  private startFit(options: RendererFitOptions): void {
    const target = this.resolveFitTarget(options);
    this.fitController?.stop();
    this.fitController = new FitController(
      this.app,
      this.app.stage,
      this.virtualWidth,
      this.virtualHeight,
      options.mode,
      target,
      this.config.width,
      this.config.height,
    );
    this.fitController.start();
  }

  /**
   * Resolve the fit target. Returns `null` when no reasonable host can be
   * inferred — the controller then applies a one-shot transform against
   * `config.width × config.height` without observing. We intentionally do
   * NOT fall through to `document.body`: a `ResizeObserver` on `body` fires
   * on any page layout change (font loads, text reflows, dynamic content),
   * not just viewport resizes, which would silently re-layout the canvas
   * every frame. Callers that want full-page fit must opt in explicitly
   * via `fit: { target: document.body }`.
   */
  private resolveFitTarget(options: RendererFitOptions): HTMLElement | null {
    if (options.target) return options.target;
    if (this.config.container) return this.config.container;
    const parent = this.config.canvas?.parentElement;
    if (parent) return parent;
    return null;
  }
}
