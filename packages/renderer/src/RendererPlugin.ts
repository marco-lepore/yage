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

  // `_app`, `_provider`, `_fitController` use definite-assignment (`!`)
  // since every method/getter past install assumes they're set; `onDestroy`
  // explicitly guards each one so a partial-install failure (e.g. `await
  // app.init()` rejecting before `_provider` is assigned) is safe to tear
  // down. The `_installed` flag tracks how far install got.
  private _app!: Application;
  private readonly _config: RendererConfig;
  private readonly _virtualWidth: number;
  private readonly _virtualHeight: number;
  private _provider!: SceneRenderTreeProviderImpl;
  private _tickerFn: (() => void) | null = null;
  private _unregisterHooks: (() => void) | null = null;
  private _fitController!: FitController;
  private _installed = {
    app: false,
    fit: false,
    provider: false,
  };
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
    this._config = config;
    this._virtualWidth = config.virtualWidth ?? config.width;
    this._virtualHeight = config.virtualHeight ?? config.height;
  }

  async install(context: EngineContext): Promise<void> {
    // 1. Create & init PixiJS Application
    this._app = new Application();
    const resolution =
      this._config.resolution ??
      (typeof window !== "undefined" ? window.devicePixelRatio : 1);
    await this._app.init({
      width: this._config.width,
      height: this._config.height,
      backgroundColor: this._config.backgroundColor ?? 0x000000,
      resolution,
      autoDensity: true,
      ...this._config.pixi,
      ...(this._config.canvas ? { canvas: this._config.canvas } : undefined),
    });
    this._installed.app = true;

    // 2. Append canvas to container if specified
    if (this._config.container) {
      this._config.container.appendChild(this._app.canvas);
    }

    // 3. FitController always owns the stage transform. When `fit` is
    //    configured (or defaulted), it observes a host element and re-maps
    //    the virtual rectangle on each resize. In environments without a
    //    DOM target (tests, headless), it applies the transform once against
    //    the initial `width × height` and installs no observer.
    this.startFit(this._config.fit ?? { mode: "letterbox" });
    this._installed.fit = true;

    // 4. Resolve ProcessSystem so layer/scene/screen-scope effects can
    //    schedule fade tweens. Already registered by Engine before plugin
    //    install runs.
    this._processSystem = context.resolve(ProcessSystemKey);

    // 4b. Build the screen-scope EffectsHost over `app.stage`. The underlying
    //     EffectStack is created lazily on first `addEffect`/`restore` so a
    //     game with no screen-scope filters pays nothing.
    const ps = this._processSystem;
    this.fx = new EffectsHost(
      () => this._app.stage,
      "screen",
      () => makeGlobalScopedQueue(ps),
    );

    // 5. Create the per-scene render tree provider.
    //    Each scene gets one root container as a direct child of app.stage.
    this._provider = new SceneRenderTreeProviderImpl(
      this._app.stage,
      this._processSystem,
    );
    this._installed.provider = true;

    // 6. Register services
    context.register(RendererKey, this);
    // Also register under the cross-package adapter key so @yagejs/input
    // (and other renderer-agnostic consumers) can auto-wire to the canvas
    // and canvasToVirtual transform without importing @yagejs/renderer.
    context.register(RendererAdapterKey, this);
    context.register(SceneRenderTreeProviderKey, this._provider);

    // 7. Register scene hooks: materialize a tree per scene on enter,
    //    tear it down on exit.
    const hookRegistry = context.resolve(SceneHookRegistryKey);
    this._unregisterHooks = hookRegistry.register({
      beforeEnter: (scene) => {
        const tree = this._provider.createForScene(scene);
        scene._registerScoped(SceneRenderTreeKey, tree);
      },
      afterExit: (scene) => {
        this._provider.destroyForScene(scene);
      },
    });

    // 8. Attach PixiJS ticker to GameLoop
    const gameLoop = context.resolve(GameLoopKey);
    gameLoop.attachTicker((callback) => {
      const fn = () => callback(this._app.ticker.deltaMS);
      this._tickerFn = fn;
      this._app.ticker.add(fn);
      return () => this._app.ticker.remove(fn);
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
    // Drop the install-time context reference once the save bridge is wired —
    // we don't need it past startup, no point holding the EngineContext alive
    // for the plugin's lifetime.
    this._engineContext = null;
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
      this._provider,
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
    // Tear down only the steps install actually completed — `_installed`
    // tracks how far we got. If install rejected mid-way (e.g.
    // `await app.init()` failed), the unset fields stay untouched here
    // instead of throwing on access.
    this._unregisterSaveContributor?.();
    this._unregisterSaveContributor = null;
    this._unregisterHooks?.();
    this._unregisterHooks = null;
    if (this._installed.fit) this._fitController.stop();
    if (this._installed.app && this._tickerFn) {
      this._app.ticker.remove(this._tickerFn);
      this._tickerFn = null;
    }
    // Strip stage-level effects before destroying the app — preserves any
    // user-assigned filters on app.stage outside our addEffect calls.
    this.fx?.destroy();
    if (this._installed.provider) this._provider.destroyAll();
    if (this._installed.app) this._app.destroy();
  }

  /** The PixiJS Application instance. */
  get application(): Application {
    return this._app;
  }

  /** The canvas element. */
  get canvas(): HTMLCanvasElement {
    return this._app.canvas;
  }

  /** Virtual resolution size. */
  get virtualSize(): { width: number; height: number } {
    return { width: this._virtualWidth, height: this._virtualHeight };
  }

  /** Current canvas size in CSS pixels. Changes on host resize under responsive fit. */
  get canvasSize(): { width: number; height: number } {
    return this._fitController.canvasSize;
  }

  /** Current fit configuration. */
  get fit(): RendererFitOptions {
    const target = this._fitController.currentTarget;
    return {
      mode: this._fitController.currentMode,
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
    return this._fitController.canvasToVirtual(x, y);
  }

  /**
   * Virtual-space pixels → CSS pixels relative to the canvas top-left.
   * Symmetric with {@link canvasToVirtual}; useful when mapping virtual
   * coordinates back out to DOM overlays or pointer regions.
   */
  virtualToCanvas(x: number, y: number): Vec2 {
    return this._fitController.virtualToCanvas(x, y);
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
    return this._fitController.visibleVirtualRect;
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
    return this._fitController.croppedVirtualRects;
  }

  /**
   * Where the declared virtual rectangle sits on the canvas, in CSS pixels.
   * Use for DOM overlays positioned over the play area, cropping screenshots
   * to gameplay, or mapping CSS-coord hit regions. The rect may extend past
   * the canvas (negative coords, dimensions larger than `canvasSize`) under
   * `cover`.
   */
  get virtualCanvasRect(): CanvasRect {
    return this._fitController.virtualCanvasRect;
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
    return this._fitController.visibleCanvasRect;
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
    return this._fitController.extendedVirtualRects;
  }

  /** The per-scene render tree provider. */
  get sceneRenderTrees(): SceneRenderTreeProvider {
    return this._provider;
  }

  /** Create a texture by drawing into a temporary graphics context. */
  createTexture(draw: (graphics: GraphicsContext) => void): TextureResource {
    const graphics = new Graphics();
    try {
      draw(graphics);
      return this._app.renderer.generateTexture(graphics);
    } finally {
      graphics.destroy();
    }
  }

  private startFit(options: RendererFitOptions): void {
    const target = this.resolveFitTarget(options);
    this._fitController?.stop();
    this._fitController = new FitController(
      this._app,
      this._app.stage,
      this._virtualWidth,
      this._virtualHeight,
      options.mode,
      target,
      this._config.width,
      this._config.height,
    );
    this._fitController.start();
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
    if (this._config.container) return this._config.container;
    const parent = this._config.canvas?.parentElement;
    if (parent) return parent;
    return null;
  }
}
