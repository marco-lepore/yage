import {
  AssetManagerKey,
  EventBusKey,
  GameLoopKey,
  InspectorKey,
  isPointerConsumeContainer,
  makeGlobalScopedQueue,
  ProcessSystemKey,
  RendererAdapterKey,
  SceneHookRegistryKey,
  SceneManagerKey,
  Vec2,
} from "@yagejs/core";
import type {
  EngineContext,
  EngineEvents,
  EventBus,
  Plugin,
  ProcessSystem,
  RendererAdapter,
  SystemScheduler,
} from "@yagejs/core";
import {
  Application as PixiApplication,
  Assets,
  Container,
  Graphics,
  TextureStyle,
} from "pixi.js";
import type { BitmapFont, Spritesheet, SCALE_MODE } from "pixi.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { RenderFacetContributor } from "./RenderFacetContributor.js";
import { FitController } from "./Fit.js";
import type { CanvasRect, VirtualRect } from "./Fit.js";
import type {
  Application,
  DisplayContainer,
  GraphicsContext,
  TextStyle,
  TextureResource,
} from "./public-types.js";
import {
  getDefaultTextStyle,
  setDefaultTextStyle,
} from "./internal/textConstruction.js";
import { createRenderTarget } from "./RenderTarget.js";
import type {
  RenderTargetHandle,
  RenderTargetOptions,
} from "./RenderTarget.js";
import { RendererKey } from "./types.js";
import type { RendererConfig, RendererFitOptions } from "./types.js";
import type { SceneRenderTreeProvider } from "./SceneRenderTree.js";
import {
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "./SceneRenderTree.js";
import { SceneRenderTreeProviderImpl } from "./SceneRenderTreeProvider.js";
import { loadTexture, loadWebFont, unloadWebFont } from "./assets.js";

import "./scene-augmentation.js";

/** RendererPlugin wraps PixiJS v8 behind the YAGE plugin interface. */
export class RendererPlugin implements Plugin, RendererAdapter {
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
  /**
   * Holds the fit transform (scale + offset) and parents every per-scene
   * render tree. Sits as the only "world" child of `app.stage`, which we
   * deliberately keep at identity.
   *
   * Why this layer exists: in Pixi v8 the active render group's transform
   * is fed to shaders via `uWorldTransformMatrix`, and `@pixi/tilemap`'s
   * pipe composes `uProjection × uWorldTransformMatrix × tilemap.worldTransform`.
   * `tilemap.worldTransform` is already cumulative from root, so any
   * non-identity transform on the active render group (= `app.stage` by
   * default) is applied twice — silently mis-scaling tile rendering vs.
   * Sprites/Graphics, which the batched renderer pre-transforms on CPU.
   * Pushing the fit onto a non-render-group child (this `_worldRoot`)
   * keeps `uWorldTransformMatrix` identity at render time. Stage-direct
   * children (transition overlays, screen-scope effects) keep their
   * intended canvas-pixel coordinates.
   */
  private _worldRoot!: DisplayContainer;
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
  private _unregisterFacetContributor: (() => void) | null = null;
  private _unregisterFullscreenListener: (() => void) | null = null;
  private _unregisterOrientationListener: (() => void) | null = null;
  private _unregisterSceneVisibility: (() => void) | null = null;
  /**
   * Snapshot of `TextureStyle.defaultOptions.scaleMode` captured before
   * `pixelArtPreset` flips it to `"nearest"`. Pixi's defaults live on a
   * module-level singleton, so without restoring this on destroy the
   * mutation leaks across plugin lifecycles — any later `RendererPlugin`
   * instance (or any texture loaded after teardown) silently inherits
   * nearest sampling even with `pixelArtPreset: false`. The companion
   * `_scaleModeCaptured` flag distinguishes "preset was off, leave the
   * field alone" from "preset was on and the original value was
   * `undefined`" — both round-trip back through the same restore.
   */
  private _originalScaleMode: SCALE_MODE | undefined = undefined;
  private _scaleModeCaptured = false;
  private _prevDefaultTextStyle: TextStyle | undefined = undefined;
  private _defaultTextStyleCaptured = false;

  constructor(config: RendererConfig) {
    this._config = config;
    this._virtualWidth = config.virtualWidth ?? config.width;
    this._virtualHeight = config.virtualHeight ?? config.height;
  }

  async install(context: EngineContext): Promise<void> {
    // 1. Apply pixel-art preset BEFORE Application.init so the texture-style
    //    default propagates to every texture/spritesheet loaded by Assets
    //    afterward. User-passed `pixi.roundPixels` still wins via the spread
    //    order below. `TextureStyle.defaultOptions` is a module-level
    //    singleton, so we capture the previous value and restore it in
    //    `onDestroy` to keep the mutation scoped to this plugin's lifetime.
    if (this._config.pixelArtPreset) {
      this._originalScaleMode = TextureStyle.defaultOptions.scaleMode;
      this._scaleModeCaptured = true;
      TextureStyle.defaultOptions.scaleMode = "nearest";
    }

    // Apply the engine-level default text style. Captured/restored like the
    // scale mode above so this module-singleton mutation stays scoped to the
    // plugin's lifetime (test isolation, multiple engines in one process).
    if (this._config.defaultTextStyle !== undefined) {
      this._prevDefaultTextStyle = getDefaultTextStyle();
      this._defaultTextStyleCaptured = true;
      setDefaultTextStyle(this._config.defaultTextStyle);
    }

    // 2. Create & init PixiJS Application
    this._app = new PixiApplication();
    const resolution =
      this._config.resolution ??
      (typeof window !== "undefined" ? window.devicePixelRatio : 1);
    await this._app.init({
      width: this._config.width,
      height: this._config.height,
      backgroundColor: this._config.backgroundColor ?? 0x000000,
      resolution,
      autoDensity: true,
      ...(this._config.pixelArtPreset ? { roundPixels: true } : undefined),
      ...this._config.pixi,
      ...(this._config.canvas ? { canvas: this._config.canvas } : undefined),
    });
    this._installed.app = true;

    // 2b. Tell the browser to scale the canvas backing store with
    //     nearest-neighbor when it's CSS-scaled past 1:1 (e.g. on a HiDPI
    //     monitor, under fit, or when the host CSS-sizes the canvas larger
    //     than its backing store). Without this the browser bicubic-blurs
    //     the pixel art back into mush. We write both declarations via
    //     `cssText` because the CSS cascade only keeps the LAST
    //     `image-rendering` value the browser understands — Safari falls
    //     through `pixelated` (which it ignores) to the older
    //     `-webkit-optimize-contrast`; everywhere else `pixelated` wins.
    //     Guarded for headless test runs that stub `canvas` as a plain
    //     object without a `style`.
    if (this._config.pixelArtPreset) {
      const style = (this._app.canvas as { style?: CSSStyleDeclaration }).style;
      if (style) {
        style.cssText +=
          "image-rendering:-webkit-optimize-contrast;image-rendering:pixelated;";
      }
    }

    // 2b. Force `display:block` on the canvas. The <canvas> UA default is
    //     `display:inline`, which seats it on the text baseline and leaves a
    //     ~4px line-box descender beneath it. On a fit host whose height is
    //     content-driven (no explicit/bounded height) that descender makes
    //     the host measure taller than the canvas the FitController just
    //     sized to it, the ResizeObserver re-fires, the canvas grows, the
    //     host grows again — an unbounded loop. `display:block` removes the
    //     descender so the host content box equals the canvas height and the
    //     controller reaches a fixed point. Canvas-local and overridable from
    //     a developer stylesheet. Guarded for headless test runs that stub
    //     `canvas` without a `style`.
    const canvasStyle = (this._app.canvas as { style?: CSSStyleDeclaration })
      .style;
    if (canvasStyle) canvasStyle.display = "block";

    // 3. Append canvas to container if specified
    if (this._config.container) {
      this._config.container.appendChild(this._app.canvas);
    }

    // 4. Insert the world-root container between `app.stage` and every
    //    per-scene tree. The fit transform lives here, not on stage —
    //    see the field-level comment on `_worldRoot` for why.
    this._worldRoot = new Container();
    this._worldRoot.label = "yage:worldRoot";
    this._app.stage.addChild(this._worldRoot);

    // 5. FitController owns the world-root transform. When `fit` is
    //    configured (or defaulted), it observes a host element and re-maps
    //    the virtual rectangle on each resize. In environments without a
    //    DOM target (tests, headless), it applies the transform once against
    //    the initial `width × height` and installs no observer.
    this.startFit(this._config.fit ?? { mode: "letterbox" });
    this._installed.fit = true;

    // 6. Resolve ProcessSystem so layer/scene/screen-scope effects can
    //    schedule fade tweens. Already registered by Engine before plugin
    //    install runs.
    this._processSystem = context.resolve(ProcessSystemKey);

    // 6b. Build the screen-scope EffectsHost over `app.stage`. The underlying
    //     EffectStack is created lazily on first `addEffect` so a game with no
    //     screen-scope filters pays nothing.
    const ps = this._processSystem;
    this.fx = new EffectsHost(
      () => this._app.stage,
      "screen",
      () => makeGlobalScopedQueue(ps),
    );

    // 7. Create the per-scene render tree provider.
    //    Each scene gets one root container as a direct child of `_worldRoot`
    //    (which is itself the only world-space child of `app.stage`).
    this._provider = new SceneRenderTreeProviderImpl(
      this._worldRoot,
      this._processSystem,
    );
    this._installed.provider = true;

    // 8. Register services
    context.register(RendererKey, this);
    // Also register under the cross-package adapter key so @yagejs/input
    // (and other renderer-agnostic consumers) can auto-wire to the canvas
    // and canvasToVirtual transform without importing @yagejs/renderer.
    context.register(RendererAdapterKey, this);
    context.register(SceneRenderTreeProviderKey, this._provider);

    // 9. Register scene hooks: materialize a tree per scene on enter,
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

    // 9b. Apply `Scene.transparentBelow` to the visibility of every below-stack
    //     scene tree. The flag was previously documented but unenforced — UI
    //     in a below scene (and any world content) painted through even when
    //     the topmost scene was meant to fully cover it. Walking the stack on
    //     every stack mutation hides scenes underneath a `transparentBelow:
    //     false` neighbour. While a scene transition is running we re-show
    //     every tree so both the outgoing and incoming scenes can render
    //     (e.g. crossFade); the chain is reapplied on `scene:transition:ended`.
    this.installSceneVisibilityListeners(context);

    // 10. Attach PixiJS ticker to GameLoop
    const gameLoop = context.resolve(GameLoopKey);
    gameLoop.attachTicker((callback) => {
      const fn = () => callback(this._app.ticker.deltaMS);
      this._tickerFn = fn;
      this._app.ticker.add(fn);
      return () => this._app.ticker.remove(fn);
    });

    // 10b. Wire viewport-lifecycle listeners (fullscreen + orientation).
    //     Both emit onto the engine event bus. Gated behind environment
    //     checks so node-environment tests that don't stub the globals
    //     skip the wiring without crashing.
    const bus = context.resolve(EventBusKey);
    this.installFullscreenListener(bus);
    this.installOrientationListener(bus);

    // 11. Register asset loaders (if AssetManager is available)
    const am = context.tryResolve(AssetManagerKey);
    am?.registerLoader("texture", {
      load: (path: string, data?: unknown) => loadTexture(path, data),
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
    am?.registerLoader("bitmap-font", {
      load: (path: string) => Assets.load<BitmapFont>(path),
      unload: (path: string) => {
        Assets.unload(path);
      },
    });
    am?.registerLoader("web-font", {
      // The `webFont` handle stashes the `@font-face` family (Pixi derives it
      // from the file name when omitted) plus the optional declarative
      // bitmap-bake config. `loadWebFont` loads the canvas face and, when
      // `bitmap` is set, bakes a `BitmapText` atlas under the same family;
      // `unloadWebFont` drops both. The bake/teardown lives in `assets.ts` so
      // it's unit-testable without standing up the whole plugin.
      load: (path: string, data?: unknown) => loadWebFont(path, data),
      unload: (path: string) => {
        unloadWebFont(path);
      },
    });

    // 12. Publish the render facet (rendered geometry + visibility) into the
    //     Inspector through `registerFacetContributor`, so `@yagejs/core`
    //     stays agnostic of any rendering concept. The Engine always
    //     registers the Inspector, so the contributor can register during
    //     install.
    const inspector = context.tryResolve(InspectorKey);
    if (inspector) {
      this._unregisterFacetContributor = inspector.registerFacetContributor(
        new RenderFacetContributor(),
      );
    }
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new DisplaySystem());
  }

  onDestroy(): void {
    // Tear down only the steps install actually completed — `_installed`
    // tracks how far we got. If install rejected mid-way (e.g.
    // `await app.init()` failed), the unset fields stay untouched here
    // instead of throwing on access.
    this._unregisterFacetContributor?.();
    this._unregisterFacetContributor = null;
    this._unregisterFullscreenListener?.();
    this._unregisterFullscreenListener = null;
    this._unregisterOrientationListener?.();
    this._unregisterOrientationListener = null;
    this._unregisterSceneVisibility?.();
    this._unregisterSceneVisibility = null;
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
    // Restore the global TextureStyle default the pixel-art preset
    // mutated on install. Skipped when nothing was captured (preset was
    // off, leave the field alone) — assigning `undefined` to
    // `defaultOptions.scaleMode` would TS-error and is the wrong shape
    // anyway, since the preset never ran.
    if (this._scaleModeCaptured) {
      if (this._originalScaleMode !== undefined) {
        TextureStyle.defaultOptions.scaleMode = this._originalScaleMode;
      }
      this._scaleModeCaptured = false;
      this._originalScaleMode = undefined;
    }

    if (this._defaultTextStyleCaptured) {
      setDefaultTextStyle(this._prevDefaultTextStyle);
      this._defaultTextStyleCaptured = false;
      this._prevDefaultTextStyle = undefined;
    }
  }

  /** The PixiJS Application instance. */
  get application(): Application {
    return this._app;
  }

  /** The canvas element. */
  get canvas(): HTMLCanvasElement {
    return this._app.canvas;
  }

  /**
   * The container that carries the responsive-fit transform — the natural
   * parent for things that should live inside the virtual play area
   * (transition overlays scoped to the play rect, world-space HUD, etc.).
   * Children operate in virtual-space pixels.
   *
   * Use `app.stage` instead when the geometry must cover the canvas
   * including letterbox / expand bars (full-screen dip-to-color overlays).
   */
  get worldRoot(): DisplayContainer {
    return this._worldRoot;
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

  /**
   * Change the fit mode and/or target at runtime. Omitting `target` keeps the
   * element the fit currently observes, so switching mode alone does not send
   * the fit back to its default host.
   */
  setFit(options: RendererFitOptions): void {
    if (options.target !== undefined) {
      this.startFit(options);
      return;
    }
    const current = this._fitController.currentTarget;
    this.startFit(current ? { ...options, target: current } : options);
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
   * Hit-test at virtual-space `(x, y)` and return `true` when the topmost
   * interactive Pixi container has any ancestor (including itself) marked via
   * `markPointerConsumeContainer`. Used by `@yagejs/input`'s drain step to
   * auto-claim presses landing on UI surfaces.
   *
   * Scope: this only sees surfaces marked via `markPointerConsumeContainer` —
   * `@yagejs/ui` primitives (`UIPanel`, `UIButton`, …) plus any visual
   * component (`Sprite`, `AnimatedSprite`, `Graphics`, `Text`, `SplitText`)
   * configured with `interactive: { consumeOnInteraction: true }`. A plain
   * sprite is not a consume surface. UI drawn on raw Pixi containers outside
   * those paths — such as the `@yagejs-addons/dialogue` box, which never
   * marks its containers — is not detected. Dialogue-aware callers should
   * gate on `DialogueController.isActive()` / `isChoosing()` instead.
   *
   * Coordinates are supplied in virtual space (matching how the input plugin
   * stores pointer positions); they are converted to canvas space via
   * `FitController.virtualToCanvas` before being forwarded to
   * `EventBoundary.hitTest`, which per the Pixi v8 spec expects canvas-
   * relative ("world space above the boundary") coordinates. At fit ratio 1
   * the two spaces coincide; at any other ratio (mobile / responsive) the
   * conversion is required for the hit-test to land on the correct surface.
   */
  hitTestUI(x: number, y: number): boolean {
    const boundary = this._app.renderer.events?.rootBoundary;
    if (!boundary) return false;
    // Pixi v8 sets `rootBoundary.rootTarget` on each render. Before the first
    // frame (or under `inspector.time.freeze()` in deterministic test runs
    // that pause the ticker) it can be null — and `boundary.hitTest` reads
    // `rootTarget.eventMode` unconditionally, so the call would crash. Bind
    // it to `_worldRoot` ourselves so the hit-test has a valid root before
    // the first frame; Pixi's render loop will keep `rootTarget` accurate
    // once frames start landing.
    if (!boundary.rootTarget) {
      boundary.rootTarget = this._worldRoot;
    }
    const canvas = this._fitController.virtualToCanvas(x, y);
    const hit = boundary.hitTest(canvas.x, canvas.y) as DisplayContainer | null;
    if (!hit) return false;
    let node: DisplayContainer | null = hit;
    while (node) {
      if (isPointerConsumeContainer(node)) return true;
      node = node.parent ?? null;
    }
    return false;
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
   * HUD).
   *
   * Under `letterbox` they only report where the background-color bars land.
   * Every scene layer is clipped to the virtual rect under that mode, so
   * content placed at these coordinates on a scene layer is invisible. To
   * draw in the bars, parent a container directly on `renderer.application.stage` and
   * position it in canvas pixels.
   */
  get extendedVirtualRects(): readonly VirtualRect[] {
    return this._fitController.extendedVirtualRects;
  }

  /** The per-scene render tree provider. */
  get sceneRenderTrees(): SceneRenderTreeProvider {
    return this._provider;
  }

  /**
   * Bake a texture once by drawing into a temporary graphics context. The
   * result never changes again; for a buffer the game redraws, use
   * {@link createRenderTarget}.
   */
  createTexture(draw: (graphics: GraphicsContext) => void): TextureResource {
    const graphics = new Graphics();
    try {
      draw(graphics);
      return this._app.renderer.generateTexture(graphics);
    } finally {
      graphics.destroy();
    }
  }

  /**
   * Create an offscreen buffer that draws `source` into a texture the game
   * owns and redraws on its own schedule — the repeatable counterpart of
   * {@link createTexture}, with control over when the buffer refreshes and
   * how many texels it gets.
   *
   * Composite the result by showing `target.texture` (a `SpriteComponent`, a
   * mask, a filter input). See {@link RenderTargetHandle} for the coordinate
   * space the source is drawn in and the reasons to keep it out of the live
   * scene graph.
   */
  createRenderTarget(
    source: DisplayContainer,
    options: RenderTargetOptions,
  ): RenderTargetHandle {
    return createRenderTarget(this._app.renderer, source, options);
  }

  // ─── Fullscreen ──────────────────────────────────────────────────

  /**
   * Request fullscreen for the renderer's host element. Targets the
   * configured `container` when present (so DOM overlays placed
   * alongside the canvas remain inside the fullscreened area), falling
   * back to the canvas itself otherwise. Wraps `Element.requestFullscreen`
   * with the legacy `webkitRequestFullscreen` fallback for iOS Safari.
   *
   * Must be called from a user-gesture handler (click, touch, key);
   * browsers reject the returned Promise with a `TypeError` otherwise.
   */
  async requestFullscreen(): Promise<void> {
    const target = this.fullscreenTarget();
    if (!target) {
      throw new Error(
        "RendererPlugin.requestFullscreen: no host element available.",
      );
    }
    await getFullscreenAPI(target).request();
  }

  /** Exit fullscreen. No-op if the page isn't currently fullscreen. */
  async exitFullscreen(): Promise<void> {
    const target = this.fullscreenTarget();
    if (!target) return;
    await getFullscreenAPI(target).exit();
  }

  /**
   * Whether the renderer's host element is currently the fullscreen
   * element. Reads live from the DOM, so this stays accurate when the
   * user exits fullscreen via Esc or the browser UI.
   */
  get isFullscreen(): boolean {
    const target = this.fullscreenTarget();
    if (!target) return false;
    const current = getFullscreenAPI(target).fullscreenElement();
    return current === target;
  }

  /**
   * Current device orientation. Returns `null` when neither the
   * `screen.orientation` API nor the legacy `window.orientation` angle
   * is available — typical of headless tests and very old browsers.
   */
  get orientation(): OrientationType | null {
    return deriveOrientationType();
  }

  private fullscreenTarget(): HTMLElement | null {
    if (this._config.container) return this._config.container;
    if (this._installed.app) return this._app.canvas;
    return null;
  }

  private installSceneVisibilityListeners(context: EngineContext): void {
    const sceneManager = context.tryResolve(SceneManagerKey);
    // SceneManager is engine-globally registered before plugin install in
    // production. The tryResolve path covers minimal test fixtures that
    // exercise the plugin without standing up an Engine.
    if (!sceneManager) return;
    const bus = context.resolve(EventBusKey);
    const recompute = (): void =>
      this._provider.applyTransparentBelow(sceneManager.all);
    const showAll = (): void =>
      this._provider.resetVisibility(sceneManager.all);
    // Event-ordering invariant relied on for push-with-transition:
    // `SceneManager.push` awaits `_pushScene` (which emits `scene:pushed`)
    // BEFORE `_runTransition` (which emits `scene:transition:started`).
    // So `recompute` runs first and may hide the outgoing scene; then
    // `showAll` re-shows it for the transition's duration; then
    // `scene:transition:ended` runs `recompute` again to settle the chain.
    // If that order ever flipped, a cross-fade-on-push would cut the
    // outgoing scene to black instead of dissolving — see the
    // "keeps the outgoing scene visible during a push-with-transition"
    // test in RendererPlugin.test.ts which pins the contract.
    const unsubs = [
      bus.on("scene:pushed", recompute),
      bus.on("scene:popped", recompute),
      bus.on("scene:replaced", recompute),
      bus.on("scene:transition:started", showAll),
      bus.on("scene:transition:ended", recompute),
    ];
    this._unregisterSceneVisibility = () => {
      for (const u of unsubs) u();
    };
  }

  private installFullscreenListener(bus: EventBus<EngineEvents>): void {
    if (typeof document === "undefined") return;
    const handler = (): void => {
      bus.emit("screen:fullscreen", { active: this.isFullscreen });
    };
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    this._unregisterFullscreenListener = () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }

  private installOrientationListener(bus: EventBus<EngineEvents>): void {
    if (typeof window === "undefined") return;
    const emit = (): void => {
      const type = deriveOrientationType();
      if (type !== null) bus.emit("screen:orientation", { type });
    };
    const orientation = window.screen?.orientation;
    if (orientation && typeof orientation.addEventListener === "function") {
      orientation.addEventListener("change", emit);
      this._unregisterOrientationListener = () => {
        orientation.removeEventListener("change", emit);
      };
      return;
    }
    // Legacy fallback: window.orientationchange. Deprecated but still the
    // only signal on older iOS Safari.
    window.addEventListener("orientationchange", emit);
    this._unregisterOrientationListener = () => {
      window.removeEventListener("orientationchange", emit);
    };
  }

  // ─── Internal ────────────────────────────────────────────────────

  private startFit(options: RendererFitOptions): void {
    const target = this.resolveFitTarget(options);
    this._fitController?.stop();
    this._fitController = new FitController(
      this._app,
      this._worldRoot,
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

// ─── Module-private helpers ──────────────────────────────────────────

interface FullscreenAPI {
  request(): Promise<void>;
  exit(): Promise<void>;
  fullscreenElement(): Element | null;
}

type WebkitElement = Element & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

type WebkitDocument = Document & {
  webkitExitFullscreen?: () => void | Promise<void>;
  webkitFullscreenElement?: Element | null;
};

/**
 * Resolve the fullscreen API at call time, picking the unprefixed
 * standard methods when present and falling back to the `webkit*`
 * variants on iOS Safari. Detection runs on each call rather than at
 * module load so the helper still works if the prefixed API is
 * polyfilled or wrapped after import.
 */
function getFullscreenAPI(el: Element): FullscreenAPI {
  if (typeof document === "undefined") {
    return {
      request: () =>
        Promise.reject(new Error("Fullscreen unavailable: no document")),
      exit: () => Promise.resolve(),
      fullscreenElement: () => null,
    };
  }
  if ("requestFullscreen" in el) {
    return {
      request: () => Promise.resolve(el.requestFullscreen()),
      exit: () => Promise.resolve(document.exitFullscreen()),
      fullscreenElement: () => document.fullscreenElement,
    };
  }
  const webkitEl = el as WebkitElement;
  const webkitDoc = document as WebkitDocument;
  if (typeof webkitEl.webkitRequestFullscreen === "function") {
    return {
      request: () => Promise.resolve(webkitEl.webkitRequestFullscreen?.()),
      exit: () => Promise.resolve(webkitDoc.webkitExitFullscreen?.()),
      fullscreenElement: () => webkitDoc.webkitFullscreenElement ?? null,
    };
  }
  return {
    request: () =>
      Promise.reject(new Error("Fullscreen API not supported in this browser")),
    exit: () => Promise.resolve(),
    fullscreenElement: () => null,
  };
}

/**
 * Best-effort device orientation read. Prefers `window.screen.orientation.type`,
 * falling back to deriving from the legacy numeric `window.orientation` angle
 * (deprecated but still the only signal on some old iOS Safari versions).
 * Returns `null` when neither API is available.
 */
function deriveOrientationType(): OrientationType | null {
  if (typeof window === "undefined") return null;
  const modern = window.screen?.orientation?.type;
  if (modern) return modern;
  const legacyAngle =
    (window as Window & { orientation?: number }).orientation ?? null;
  if (legacyAngle === null) return null;
  if (legacyAngle === 0) return "portrait-primary";
  if (legacyAngle === 180) return "portrait-secondary";
  if (legacyAngle === 90) return "landscape-primary";
  if (legacyAngle === -90 || legacyAngle === 270) return "landscape-secondary";
  return null;
}
