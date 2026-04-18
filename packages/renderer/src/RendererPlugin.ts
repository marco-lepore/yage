import {
  AssetManagerKey,
  GameLoopKey,
  SceneHookRegistryKey,
} from "@yagejs/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { Application, Assets, Graphics } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import { DisplaySystem } from "./DisplaySystem.js";
import type { GraphicsContext, TextureResource } from "./public-types.js";
import { RendererKey } from "./types.js";
import type { RendererConfig } from "./types.js";
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

    // 3. Apply virtual resolution scaling to app.stage
    const scale = Math.min(
      this.config.width / this.virtualWidth,
      this.config.height / this.virtualHeight,
    );
    const offsetX = (this.config.width - this.virtualWidth * scale) / 2;
    const offsetY = (this.config.height - this.virtualHeight * scale) / 2;
    this.app.stage.scale.set(scale, scale);
    this.app.stage.position.set(offsetX / scale, offsetY / scale);

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
}
