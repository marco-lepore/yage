import {
  AssetManagerKey,
  GameLoopKey,
  makeGlobalScopedQueue,
  ProcessSystemKey,
  RendererAdapterKey,
  SceneHookRegistryKey,
  Vec2,
} from "@yagejs/core";
import type {
  EngineContext,
  Plugin,
  ProcessSystem,
  ServiceKey,
  SystemScheduler,
} from "@yagejs/core";
import type { SnapshotContributor } from "@yagejs/save";
// `@yagejs/save` is an optional peer dep — type-only import via top-level
// `import type * as` keeps the runtime free of a hard dependency on the
// save package while letting us reference `typeof SaveModule` for the
// dynamic-import variable below.
import type * as SaveModule from "@yagejs/save";
import { Application, Assets, Graphics } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { RendererSnapshotContributor } from "./effects/RendererSnapshotContributor.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { FitController } from "./Fit.js";
import type { CanvasRect, VirtualRect } from "./Fit.js";
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

interface SaveServiceLike {
  registerSnapshotExtra(key: string, contributor: SnapshotContributor): void;
  unregisterSnapshotExtra(key: string): void;
}

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
  private _processSystem: ProcessSystem | undefined;
  /**
   * Screen-scope effects host — `.fx.addEffect(...)` attaches a filter to
   * `app.stage`, so it persists across scene transitions and composites
   * everything the renderer draws (every scene, every layer). Common use:
   * screen-wide post-process like vignette or chromatic aberration.
   *
   * The handle survives scene changes; remove it explicitly when no longer
   * wanted, or it lives until the renderer plugin is destroyed.
   */
  fx!: EffectsHost;
  private _engineContext: EngineContext | null = null;
  private _unregisterSaveContributor: (() => void) | null = null;

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

    // 4. Resolve ProcessSystem so layer/scene/screen-scope effects can
    //    schedule fade tweens. Already registered by Engine before plugin
    //    install runs.
    this._processSystem = context.resolve(ProcessSystemKey);

    // 4b. Build the screen-scope EffectsHost over `app.stage`. The underlying
    //     EffectStack is created lazily on first `addEffect`/`restore` so a
    //     game with no screen-scope filters pays nothing.
    const ps = this._processSystem;
    this.fx = new EffectsHost(
      () => this.app.stage,
      "screen",
      () => makeGlobalScopedQueue(ps),
    );

    // 5. Create the per-scene render tree provider.
    //    Each scene gets one root container as a direct child of app.stage.
    this.provider = new SceneRenderTreeProviderImpl(
      this.app.stage,
      this._processSystem,
    );

    // 6. Register services
    context.register(RendererKey, this);
    // Also register under the cross-package adapter key so @yagejs/input
    // (and other renderer-agnostic consumers) can auto-wire to the canvas
    // and canvasToVirtual transform without importing @yagejs/renderer.
    context.register(RendererAdapterKey, this);
    context.register(SceneRenderTreeProviderKey, this.provider);

    // 7. Register scene hooks: materialize a tree per scene on enter,
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

    // 10. Stash the context for use in onStart, where the save bridge is
    //     wired up — we need to wait for every plugin to install before
    //     resolving SaveServiceKey, otherwise registration order matters.
    this._engineContext = context;
  }

  async onStart(): Promise<void> {
    // Bridge layer/scene/screen-scope effects + masks into the save system.
    // `@yagejs/save` is an optional peer dep — the dynamic import + try/catch
    // lets the renderer keep working when it's not installed (the contributor
    // simply doesn't register). Done in onStart, not install, so RendererPlugin
    // and SavePlugin can be registered in any order.
    if (!this._engineContext) return;
    await this.tryRegisterSaveContributor(this._engineContext);
  }

  private async tryRegisterSaveContributor(
    context: EngineContext,
  ): Promise<void> {
    let save: typeof SaveModule;
    try {
      save = await import("@yagejs/save");
    } catch {
      // @yagejs/save not installed — save support for renderer-scope effects
      // is unavailable. Component-scope effects still serialize through the
      // visual components' own snapshot path.
      return;
    }
    const key = save.SaveServiceKey as
      | ServiceKey<SaveServiceLike>
      | undefined;
    if (!key) return;
    const service = context.tryResolve(key);
    if (!service) return;
    const contributor: SnapshotContributor = new RendererSnapshotContributor(
      this.provider,
      () => this.fx,
    );
    service.registerSnapshotExtra("renderer", contributor);
    this._unregisterSaveContributor = () => {
      service.unregisterSnapshotExtra("renderer");
    };
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new DisplaySystem());
  }

  onDestroy(): void {
    this._unregisterSaveContributor?.();
    this._unregisterSaveContributor = null;
    this.unregisterHooks?.();
    this.unregisterHooks = null;
    this.fitController.stop();
    if (this.tickerFn) {
      this.app.ticker.remove(this.tickerFn);
      this.tickerFn = null;
    }
    // Strip stage-level effects before destroying the app — preserves any
    // user-assigned filters on app.stage outside our addEffect calls.
    this.fx?.destroy();
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

  /**
   * Virtual-space pixels → CSS pixels relative to the canvas top-left.
   * Symmetric with {@link canvasToVirtual}; useful when mapping virtual
   * coordinates back out to DOM overlays or pointer regions.
   */
  virtualToCanvas(x: number, y: number): Vec2 {
    return this.fitController.virtualToCanvas(x, y);
  }

  /**
   * Sub-rectangle of the declared virtual space that is actually on-screen.
   * Use this to anchor HUD / UI that must stay inside the play area; use
   * {@link visibleCanvasRect} if your HUD is allowed to live in the bars.
   * Gameplay queries should stay on `virtualSize`.
   *
   * Under `letterbox` / `expand` / `stretch` this equals the full virtual
   * rect. Under `cover` the long axis is cropped by the canvas edges.
   */
  get visibleVirtualRect(): VirtualRect {
    return this.fitController.visibleVirtualRect;
  }

  /**
   * Rectangles of virtual space that are currently off-screen — the
   * complement of {@link visibleVirtualRect} inside `virtualSize`. Use
   * these for effects that need to reason about cropped regions (e.g.
   * fog-of-war overlays at the visible boundary).
   *
   * Empty under `letterbox` / `expand` / `stretch`. Under `cover`, returns 1–2 strips.
   */
  get croppedVirtualRects(): readonly VirtualRect[] {
    return this.fitController.croppedVirtualRects;
  }

  /**
   * Where the declared virtual rectangle sits on the canvas, in CSS pixels.
   * Use for DOM overlays positioned over the play area, cropping screenshots
   * to gameplay, or mapping CSS-coord hit regions. The rect may extend past
   * the canvas (negative coords, dimensions larger than `canvasSize`) under
   * `cover`.
   */
  get virtualCanvasRect(): CanvasRect {
    return this.fitController.virtualCanvasRect;
  }

  /**
   * Full canvas extent expressed in virtual-space pixels — unlike
   * {@link visibleVirtualRect}, not clamped to the declared virtual rect.
   * Under `letterbox` / `expand` on an off-aspect host this extends past
   * `virtualSize` on the unscaled axis (useful for drawing backdrops that
   * fill the bars). Under `cover` it equals `visibleVirtualRect`; under
   * `stretch` it equals the virtual rect.
   */
  get visibleCanvasRect(): VirtualRect {
    return this.fitController.visibleCanvasRect;
  }

  /**
   * Rectangles of the visible canvas OUTSIDE the declared virtual rect —
   * the letterbox/expand "bars" expressed in virtual-space pixels.
   *
   * Populated under `letterbox` and `expand` whenever aspect mismatches;
   * empty under `cover` and `stretch`. Under `expand` these are the
   * play-adjacent strips the game is expected to draw into (fog, parallax,
   * HUD). Under `letterbox` they describe where the background-color bars
   * land — so bar-customization can layer on top of a letterbox render.
   */
  get extendedVirtualRects(): readonly VirtualRect[] {
    return this.fitController.extendedVirtualRects;
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
