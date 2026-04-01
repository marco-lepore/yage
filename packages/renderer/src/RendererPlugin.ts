import { AssetManagerKey, GameLoopKey } from "@yage/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yage/core";
import { Application, Assets, Container, Graphics } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import { Camera } from "./Camera.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { RenderLayerManager } from "./RenderLayer.js";
import type { GraphicsContext, TextureResource } from "./public-types.js";
import {
  CameraKey,
  RenderLayerManagerKey,
  RendererKey,
  StageKey,
} from "./types.js";
import type { RendererConfig } from "./types.js";

/** RendererPlugin wraps PixiJS v8 behind the YAGE plugin interface. */
export class RendererPlugin implements Plugin {
  readonly name = "renderer";
  readonly version = "2.0.0";

  private app!: Application;
  private readonly config: RendererConfig;
  private readonly virtualWidth: number;
  private readonly virtualHeight: number;
  private layerManager!: RenderLayerManager;
  private worldContainer!: Container;
  private tickerFn: (() => void) | null = null;

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

    // 3. Create world container (child of app.stage, handles camera transform)
    this.worldContainer = new Container();
    this.app.stage.addChild(this.worldContainer);

    // 4. Apply virtual resolution scaling to app.stage
    const scale = Math.min(
      this.config.width / this.virtualWidth,
      this.config.height / this.virtualHeight,
    );
    const offsetX = (this.config.width - this.virtualWidth * scale) / 2;
    const offsetY = (this.config.height - this.virtualHeight * scale) / 2;
    this.app.stage.scale.set(scale, scale);
    this.app.stage.position.set(offsetX / scale, offsetY / scale);

    // 5. Create RenderLayerManager
    this.layerManager = new RenderLayerManager(this.worldContainer);

    // 6. Create Camera
    const camera = new Camera(this.virtualWidth, this.virtualHeight);

    // 7. Register services
    context.register(RendererKey, this);
    context.register(StageKey, this.worldContainer);
    context.register(CameraKey, camera);
    context.register(RenderLayerManagerKey, this.layerManager);

    // 8. Attach PixiJS ticker to GameLoop
    const gameLoop = context.resolve(GameLoopKey);
    gameLoop.attachTicker((callback) => {
      const fn = () => callback(this.app.ticker.deltaMS);
      this.tickerFn = fn;
      this.app.ticker.add(fn);
      return () => this.app.ticker.remove(fn);
    });

    // 9. Register asset loaders (if AssetManager is available)
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
    if (this.tickerFn) {
      this.app.ticker.remove(this.tickerFn);
      this.tickerFn = null;
    }
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

  /** The layer manager. */
  get layers(): RenderLayerManager {
    return this.layerManager;
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
