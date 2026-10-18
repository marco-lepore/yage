import {
  AssetManagerKey,
  EventBusKey,
  GameLoopKey,
  InspectorKey,
  getPointerConsumePolicy,
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
  HostSupport,
  Plugin,
  ProcessSystem,
  RendererAdapter,
  RendererPointerEventType,
  RendererUIHit,
  SystemScheduler,
} from "@yagejs/core";
import {
  Application as PixiApplication,
  Assets,
  Container,
  Graphics,
  Rectangle,
  TextureStyle,
  UPDATE_PRIORITY,
} from "pixi.js";
import type {
  BitmapFont,
  Spritesheet,
  SCALE_MODE,
  WebGLRenderer,
  WebGPURenderer,
} from "pixi.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { synchronizeInteraction } from "./drawing.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { RenderFacetContributor } from "./RenderFacetContributor.js";
import { FitController } from "./Fit.js";
import type { CanvasRect, VirtualRect } from "./Fit.js";
import type { DrawContext } from "./DrawContext.js";
import { HostDisplayKey } from "./HostDisplay.js";
import type {
  HostFullscreen,
  HostOrientation,
  OrientationLock,
} from "./HostDisplay.js";
import {
  createPageFullscreen,
  createPageOrientation,
} from "./internal/pageDisplay.js";
import type {
  Application,
  DisplayContainer,
  TextStyle,
  TextureResource,
} from "./public-types.js";
import {
  getDefaultTextStyle,
  setDefaultTextStyle,
} from "./internal/textConstruction.js";
import { createBakedTarget, createRenderTarget } from "./RenderTarget.js";
import type {
  RenderTargetHandle,
  RenderTargetOptions,
} from "./RenderTarget.js";
import { readGraphicsCapabilities } from "./GraphicsCapabilities.js";
import type { GraphicsCapabilities } from "./GraphicsCapabilities.js";
import type { GraphicsDiagnostics } from "./GraphicsDiagnostics.js";
import { RendererKey } from "./types.js";
import type {
  RendererBackend,
  RendererConfig,
  RendererFitOptions,
} from "./types.js";
import type { SceneRenderTreeProvider } from "./SceneRenderTree.js";
import {
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "./SceneRenderTree.js";
import { SceneRenderTreeProviderImpl } from "./SceneRenderTreeProvider.js";
import { loadDataTexture, unloadDataTexture } from "./dataTexture.js";
import { installMaterialPipe } from "./materials/MaterialPipe.js";
import { loadTexture, loadWebFont, unloadWebFont } from "./assets.js";
import { assertPositiveNumber } from "./internal/validate.js";
import { stringEvaluationAllowed } from "./internal/stringEvaluation.js";

import "./scene-augmentation.js";

/** The DOM event each synthetic pointer event is dispatched as. */
const DOM_POINTER_EVENTS: Record<RendererPointerEventType, string> = {
  down: "pointerdown",
  up: "pointerup",
  move: "pointermove",
};

/**
 * `PointerEvent.buttons` bit per mouse button, as the DOM numbers them: left
 * is 1, right 2, middle 4.
 */
const POINTER_BUTTON_BITS = { 0: 1, 1: 4, 2: 2 } as const;

/** Identifies the one pointer {@link RendererPlugin.dispatchPointerEvent} drives. */
const SYNTHETIC_POINTER_ID = 1;

/** `PointerEvent.button` for an event that presses and releases nothing. */
const NO_BUTTON_CHANGE = -1;

/**
 * The graphics APIs the renderer draws with, in Pixi's own order. Pixi's
 * Canvas 2D renderer draws no light, skips every filter and ignores inverse
 * masks, so a game that reached it would run half-drawn without saying so.
 */
const DRAWN_BACKENDS = ["webgl", "webgpu"] as const;

/** One graphics API the renderer draws with. */
type DrawnBackend = (typeof DRAWN_BACKENDS)[number];

/** The region {@link RendererPlugin.createTexture} bakes, in pixels. */
export interface CreateTextureOptions {
  /** Width of the baked texture, measured from x = 0. */
  readonly width: number;
  /** Height of the baked texture, measured from y = 0. */
  readonly height: number;
}

/**
 * RendererPlugin wraps PixiJS v8 behind the YAGE plugin interface. It draws
 * under a content security policy whose `script-src` omits `'unsafe-eval'`:
 * on such a page it loads PixiJS's prebuilt shader and uniform code itself.
 */
export class RendererPlugin implements Plugin, RendererAdapter {
  readonly name = "renderer";
  /** Whether automatic canvas and render-target drawing is enabled. */
  drawingEnabled = true;
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
  /**
   * Parents every scene's canvas-space layers: a sibling of `_worldRoot`
   * above it, so those layers draw in canvas pixels, outside the fit
   * transform and the letterbox mask, above every scene's other layers.
   */
  private _canvasRoot!: DisplayContainer;
  private _installed = {
    app: false,
    fit: false,
    provider: false,
  };
  private _processSystem: ProcessSystem | undefined;
  /**
   * `PointerEvent.buttons` the synthetic pointer currently holds. A move
   * reports it, so a drag between a press and its release looks to a handler
   * the way a person's drag does.
   */
  private _syntheticPointerButtons = 0;
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
  private _context: EngineContext | null = null;
  private _unregisterSceneVisibility: (() => void) | null = null;
  /**
   * The display parts in use, the page's unless a host adapter registered a
   * {@link HostDisplay}. Both are set from `onStart` to `onDestroy` and `null`
   * outside that span, which is where every display member reports that it is
   * unavailable.
   */
  private _fullscreen: HostFullscreen | null = null;
  private _orientation: HostOrientation | null = null;
  private _stopDisplay: Array<() => void> = [];
  /** The last state the renderer read, and the state its events describe. */
  private _lastFullscreen = false;
  private _lastOrientation: OrientationType | null = null;
  /**
   * The transition in flight, which a second call joins. A browser rejects a
   * second request made in the same task, and a player toggling a button
   * expects the last call to win.
   */
  private _pendingRequest: Promise<void> | null = null;
  private _pendingExit: Promise<void> | null = null;
  private _bus: EventBus<EngineEvents> | null = null;
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
  /** The backends Pixi is asked for, narrowed from the configured preference. */
  private readonly _backends: readonly DrawnBackend[];
  /**
   * What the graphics context reports, read once per context. `null` outside
   * the window from `install` to `onDestroy`, where the two public readers
   * throw instead of reporting a context that does not exist.
   */
  private _capabilities: GraphicsCapabilities | null = null;
  private _contextLost = false;
  /**
   * Context changes waiting for a tick. A game handler runs between frames
   * rather than inside Pixi's own recovery, where throwing would stop the
   * systems queued behind it.
   */
  private _contextNotices: boolean[] = [];
  private _onCanvasContextLost: (() => void) | null = null;
  private _contextRunner: { contextChange(): void } | null = null;
  /**
   * The GPU device whose loss is being awaited. A restore brings a new
   * device, and the promise of the replaced one resolves against nothing.
   */
  private _watchedDevice: GPUDevice | null = null;
  private _inspector: { removeExtension(namespace: string): void } | null =
    null;

  constructor(config: RendererConfig) {
    this._config = config;
    this._virtualWidth = config.virtualWidth ?? config.width;
    this._virtualHeight = config.virtualHeight ?? config.height;
    this._backends = resolveBackends(config.pixi?.preference);
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

    // 2. Create & init PixiJS Application. PixiJS writes shader and uniform
    //    code at run time; on a page that forbids turning strings into code,
    //    its prebuilt replacements are loaded first.
    if (!stringEvaluationAllowed()) {
      await import("./internal/noStringEvaluation.js");
    }
    installMaterialPipe();
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
      // After the spread: the narrowed list is what the renderer draws with,
      // whatever shape the configured preference had.
      preference: [...this._backends],
      ...(this._config.canvas ? { canvas: this._config.canvas } : undefined),
    });
    this._installed.app = true;
    this.watchGraphicsContext();
    const draw = this._app.render;
    this._app.ticker.remove(draw, this._app);
    this._app.render = () => {
      if (this.drawingEnabled) draw.call(this._app);
      else synchronizeInteraction(this._app.stage);
    };
    this._app.ticker.add(this._app.render, this._app, UPDATE_PRIORITY.LOW);

    // 2b. Tell the browser to scale the canvas backing store with
    //     nearest-neighbor when it's CSS-scaled past 1:1 (e.g. on a HiDPI
    //     monitor, under fit, or when the host element CSS-sizes the canvas
    //     larger than its backing store). Without this the browser
    //     bicubic-blurs the pixel art back into mush. We write both
    //     declarations via `cssText` because the CSS cascade only keeps the
    //     LAST `image-rendering` value the browser understands — Safari falls
    //     through `pixelated` (which it ignores) to the older
    //     `-webkit-optimize-contrast`; everywhere else `pixelated` wins.
    //     Guarded for headless test runs that stub `canvas` as a plain object
    //     without a `style`.
    if (this._config.pixelArtPreset) {
      const style = (this._app.canvas as { style?: CSSStyleDeclaration }).style;
      if (style) {
        style.cssText +=
          "image-rendering:-webkit-optimize-contrast;image-rendering:pixelated;";
      }
    }

    // 2b. Force `display:block` on the canvas. The <canvas> UA default is
    //     `display:inline`, which seats it on the text baseline and leaves a
    //     ~4px line-box descender beneath it. On a fit host element whose
    //     height is content-driven (no explicit/bounded height) that descender
    //     makes the element measure taller than the canvas the FitController
    //     just sized to it, the ResizeObserver re-fires, the canvas grows, the
    //     element grows again — an unbounded loop. `display:block` removes the
    //     descender so the element's content box equals the canvas height and
    //     the controller reaches a fixed point. Canvas-local and overridable
    //     from a developer stylesheet. Guarded for headless test runs that stub
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
    this._canvasRoot = new Container();
    this._canvasRoot.label = "yage:canvasRoot";
    this._app.stage.addChild(this._canvasRoot);

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
    //    (which is itself the only world-space child of `app.stage`), and one
    //    for its canvas-space layers under `_canvasRoot`. A render-target
    //    layer gets a target that redraws before every stage render.
    this._provider = new SceneRenderTreeProviderImpl(
      this._worldRoot,
      this._processSystem,
      this._canvasRoot,
      (source, options) =>
        createRenderTarget(
          this._app.renderer,
          source,
          {
            ...options,
            // A context with no multisampled render target draws the texture
            // the same either way; asking for one only earns a warning.
            antialias:
              options.antialias === true && this.capabilities.maxSamples > 0,
          },
          {
            stage: this._app.stage,
            isEnabled: () => this.drawingEnabled,
            refresh: options.refresh ?? "every-frame",
          },
        ),
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
      const fn = () => {
        this.flushContextNotices();
        callback(this._app.ticker.deltaMS);
      };
      this._tickerFn = fn;
      this._app.ticker.add(fn);
      return () => this._app.ticker.remove(fn);
    });

    // 10b. Keep the bus the display events are emitted on. Which display the
    //     renderer reads is resolved in `onStart`, once every plugin has
    //     installed and a host adapter could have registered one.
    this._bus = context.resolve(EventBusKey);

    // 11. Register asset loaders (if AssetManager is available)
    const am = context.tryResolve(AssetManagerKey);
    am?.registerLoader("data-texture", {
      load: loadDataTexture,
      unload: unloadDataTexture,
    });
    am?.registerLoader("texture", {
      load: (path: string, data?: unknown) => loadTexture(path, data),
      unload: (path: string) => {
        return Assets.unload(path);
      },
    });
    am?.registerLoader("render-asset", {
      load: (path: string) => Assets.load(path),
      unload: (path: string) => {
        return Assets.unload(path);
      },
    });
    am?.registerLoader("spritesheet", {
      load: (path: string) => Assets.load<Spritesheet>(path),
      unload: (path: string) => {
        return Assets.unload(path);
      },
    });
    am?.registerLoader("bitmap-font", {
      load: (path: string) => Assets.load<BitmapFont>(path),
      unload: (path: string) => {
        return Assets.unload(path);
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

    // 12. Keep the context for onStart, which publishes the render facet.
    this._context = context;
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new DisplaySystem());
  }

  onStart(): void {
    // Pick the display parts first. A host adapter registers its HostDisplay
    // during install, so every install has run by now whatever order the
    // plugins were registered in, and the page supplies each part the adapter
    // leaves out.
    const display = this._context?.tryResolve(HostDisplayKey);
    const sync = (): void => this._syncDisplay();
    const hostFullscreen = display?.fullscreen;
    const target = this.fullscreenTarget();
    if (hostFullscreen) {
      this._fullscreen = hostFullscreen;
    } else if (target) {
      const page = createPageFullscreen(target);
      this._fullscreen = page.part;
      this._stopDisplay.push(page.watch(sync));
    }
    const hostOrientation = display?.orientation;
    if (hostOrientation) {
      this._orientation = hostOrientation;
    } else {
      const page = createPageOrientation();
      this._orientation = page.part;
      this._stopDisplay.push(page.watch(sync));
    }
    if (display) this._stopDisplay.push(display.watch(sync));
    // The state at start is the baseline the events are measured against, so
    // reading it emits nothing.
    if (this._fullscreen) {
      this._lastFullscreen = readFullscreenActive(this._fullscreen);
    }
    if (this._orientation) {
      this._lastOrientation = readOrientation(this._orientation);
    }

    // Publish the render facet (rendered geometry + visibility) into the
    // Inspector through `registerFacetContributor`, so `@yagejs/core` stays
    // agnostic of any rendering concept. In onStart rather than install: the
    // Inspector is installed by a plugin (DebugPlugin or InspectorPlugin),
    // and every install has run by now whatever order the plugins were
    // registered in.
    const inspector = this._context?.tryResolve(InspectorKey);
    if (inspector) {
      this._unregisterFacetContributor = inspector.registerFacetContributor(
        new RenderFacetContributor(),
      );
      const diagnostics: GraphicsDiagnostics = {
        capabilities: () => this.capabilities,
        contextLost: () => this.contextLost,
      };
      inspector.addExtension("graphics", diagnostics);
      this._inspector = inspector;
    }
  }

  onDestroy(): void {
    // Tear down only the steps install actually completed — `_installed`
    // tracks how far we got. If install rejected mid-way (e.g.
    // `await app.init()` failed), the unset fields stay untouched here
    // instead of throwing on access.
    this._unregisterFacetContributor?.();
    this._unregisterFacetContributor = null;
    this._inspector?.removeExtension("graphics");
    this._inspector = null;
    this._context = null;
    if (this._installed.app) {
      const canvas = this._app.canvas as Partial<EventTarget>;
      if (this._onCanvasContextLost && canvas.removeEventListener) {
        canvas.removeEventListener(
          "webglcontextlost",
          this._onCanvasContextLost,
        );
      }
      if (this._contextRunner) {
        this._app.renderer.runners.contextChange.remove(this._contextRunner);
      }
    }
    this._onCanvasContextLost = null;
    this._contextRunner = null;
    this._watchedDevice = null;
    this._contextNotices = [];
    this._capabilities = null;
    for (const stop of this._stopDisplay) stop();
    this._stopDisplay = [];
    this._fullscreen = null;
    this._orientation = null;
    this._pendingRequest = null;
    this._pendingExit = null;
    this._bus = null;
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

  /**
   * What the graphics context the renderer draws with can do. Read when the
   * renderer installs and again after a lost context is restored; each read
   * is a new frozen object.
   */
  get capabilities(): GraphicsCapabilities {
    return this.assertContextKnown("capabilities");
  }

  /**
   * Whether the graphics context is lost. While it is, nothing draws and the
   * canvas keeps its last frame. `graphics:context` reports each change.
   */
  get contextLost(): boolean {
    this.assertContextKnown("contextLost");
    return this._contextLost;
  }

  private assertContextKnown(member: string): GraphicsCapabilities {
    const capabilities = this._capabilities;
    if (capabilities === null) {
      throw new Error(
        `RendererPlugin.${member}: the graphics context is only known from ` +
          "the renderer's install to engine.destroy().",
      );
    }
    return capabilities;
  }

  /**
   * Read what the context Pixi settled on can do and follow it from there: a
   * lost context is reported to the game, and a replacement is read again, so
   * every reader sees the context that is drawing.
   */
  private watchGraphicsContext(): void {
    const pixi = this._app.renderer;
    this._capabilities = readGraphicsCapabilities(pixi);
    if (pixi.name === "webgl") {
      const gl = (pixi as WebGLRenderer).gl;
      this._contextLost = gl.isContextLost();
      const canvas = this._app.canvas as Partial<EventTarget>;
      if (canvas.addEventListener) {
        const listener = (): void => this.noteContextLost();
        this._onCanvasContextLost = listener;
        canvas.addEventListener("webglcontextlost", listener);
      }
    } else {
      this.watchDevice((pixi as WebGPURenderer).gpu.device);
    }
    // A private object rather than the plugin itself, so the renderer gains
    // no public method named after a Pixi runner.
    const runner = { contextChange: () => this.noteContextRestored() };
    this._contextRunner = runner;
    pixi.runners.contextChange.add(runner);
  }

  /**
   * Wait for a WebGPU device to be lost. A device the engine itself tore down
   * reports `"destroyed"`, and a device Pixi has already replaced is no
   * longer the one drawing.
   */
  private watchDevice(device: GPUDevice): void {
    this._watchedDevice = device;
    void device.lost.then((info) => {
      if (info.reason === "destroyed") return;
      if (this._watchedDevice !== device) return;
      this.noteContextLost();
    });
  }

  private noteContextLost(): void {
    this._contextLost = true;
    this._contextNotices.push(true);
  }

  private noteContextRestored(): void {
    const pixi = this._app.renderer;
    this._capabilities = readGraphicsCapabilities(pixi);
    this._contextLost = false;
    if (pixi.name === "webgpu") {
      this.watchDevice((pixi as WebGPURenderer).gpu.device);
    }
    this._contextNotices.push(false);
  }

  /**
   * Report the context changes since the last frame, oldest first, before the
   * game loop runs. A throwing handler keeps the notices behind it queued for
   * the next frame.
   */
  private flushContextNotices(): void {
    while (this._contextNotices.length > 0) {
      const lost = this._contextNotices.shift() as boolean;
      this._bus?.emit("graphics:context", { lost });
    }
  }

  /**
   * The PixiJS Application instance, for tools and for code that adds its
   * own Pixi objects to the stage. Game code draws through visual components
   * on scene layers.
   */
  get application(): Application {
    return this._app;
  }

  /** The canvas element. */
  get canvas(): HTMLCanvasElement {
    return this._app.canvas;
  }

  /**
   * The graphics API drawing the canvas, `"webgl"` or `"webgpu"`. The
   * renderer asks Pixi for WebGL, then WebGPU, and never for Pixi's 2D canvas;
   * `RendererConfig.pixi.preference` moves WebGPU to the front.
   * {@link capabilities} reports the WebGL version and the context's limits.
   */
  get backend(): RendererBackend {
    return this._app.renderer.name as RendererBackend;
  }

  /**
   * The container that carries the responsive-fit transform. Its children
   * are in virtual pixels, and under `letterbox` they are clipped to the
   * play area.
   *
   * For code that adds its own Pixi objects inside the fit, such as a
   * rendering tool. Game code draws through visual components on scene
   * layers, and a custom scene transition covers the swap with
   * `createTransitionOverlay`.
   */
  get worldRoot(): DisplayContainer {
    return this._worldRoot;
  }

  /** Virtual resolution size. */
  get virtualSize(): { width: number; height: number } {
    return { width: this._virtualWidth, height: this._virtualHeight };
  }

  /**
   * Current canvas size in CSS pixels. Changes on host-element resize under
   * responsive fit.
   */
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
   * the fit back to its default host element.
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
   * interactive Pixi container resolves to a consuming policy. The nearest
   * explicit boolean wins; UI without an explicit ancestor defaults to true.
   * The input drain uses this to claim presses landing on UI surfaces.
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
    return this.hitTestUIPath(x, y)?.consumed ?? false;
  }

  /**
   * The hit test behind {@link hitTestUI}, reporting what it found: the
   * topmost interactive container and its ancestors, innermost first, plus
   * their resolved consumption policy. `null` when nothing
   * interactive sits under `(x, y)`.
   *
   * Callers that address a container — matching it against an Inspector
   * user-interface snapshot, for one — need the chain rather than the
   * boolean. Same coordinate contract as {@link hitTestUI}: `(x, y)` is in
   * virtual space.
   */
  hitTestUIPath(x: number, y: number): RendererUIHit | null {
    const boundary = this._app.renderer.events?.rootBoundary;
    if (!boundary) return null;
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
    if (!hit) return null;
    const path: DisplayContainer[] = [];
    let consumed: boolean | undefined;
    let hasUI = false;
    let node: DisplayContainer | null = hit;
    while (node) {
      path.push(node);
      const policy = getPointerConsumePolicy(node);
      if (policy !== undefined) hasUI = true;
      if (consumed === undefined && typeof policy === "boolean") {
        consumed = policy;
      }
      node = node.parent ?? null;
    }
    return { path, consumed: consumed ?? hasUI };
  }

  /**
   * Whether a frame has been drawn. Pixi roots its event boundary at the last
   * object rendered and drops an event silently when there is none, so a
   * pointer dispatched before the first frame reaches nothing.
   */
  hasRenderedFrame(): boolean {
    return this._app.renderer.lastObjectRendered != null;
  }

  /**
   * Deliver a pointer event at virtual-space `point`, so Pixi hit-tests and
   * delivers it the way it does for a person clicking: a `@yagejs/ui` button
   * runs its `onClick`, and stacking order, a disabled button's pointer mode
   * and clipping all apply. `button` is the mouse button a press or a release
   * carries; a move omits it and reports whichever buttons a press left held.
   *
   * The event goes to the canvas, never to the window: Pixi renames a
   * pointer-up whose composed path starts elsewhere to `pointerupoutside`,
   * which skips a button's click path. It bubbles, because `@yagejs/input`
   * listens for pointer-up on the window in the bubble phase — so the engine
   * receives the same event and applies it at the next drain, one frame after
   * the handler has already run.
   *
   * One primary mouse pointer, id {@link SYNTHETIC_POINTER_ID}. Multi-touch
   * is not reachable this way.
   */
  dispatchPointerEvent(
    type: RendererPointerEventType,
    point: { x: number; y: number },
    button?: 0 | 1 | 2,
  ): void {
    if (!this.hasRenderedFrame()) {
      throw new Error(
        "RendererPlugin.dispatchPointerEvent() needs a rendered frame: " +
          "the event boundary hit-tests against the last object rendered and " +
          "drops every event until one exists. Step one frame first.",
      );
    }
    const bit = button === undefined ? 0 : POINTER_BUTTON_BITS[button];
    if (type === "down") this._syntheticPointerButtons |= bit;
    if (type === "up") this._syntheticPointerButtons &= ~bit;
    const canvas = this.canvas;
    const offset = this._fitController.virtualToCanvas(point.x, point.y);
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent(DOM_POINTER_EVENTS[type], {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: rect.left + offset.x,
        clientY: rect.top + offset.y,
        button: type === "move" ? NO_BUTTON_CHANGE : (button ?? 0),
        buttons: this._syntheticPointerButtons,
        pointerId: SYNTHETIC_POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
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
   * Under `letterbox` / `expand` on an off-aspect host element this extends
   * past `virtualSize` on the unscaled axis (useful for drawing backdrops that
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
   * Every world and screen layer is clipped to the virtual rect under that
   * mode, so content placed at these coordinates on one is invisible. To
   * draw in the bars, put the content on a `space: "canvas"` layer and
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
   * result never changes again; for a texture the game redraws, declare a
   * layer with `renderTarget`.
   *
   * With `size`, the texture measures exactly that region of the drawing,
   * starting at `(0, 0)`: a 4-frame strip of 32-pixel cells is `width: 128,
   * height: 32` however much of each cell the drawing covers. Without it the
   * texture is the drawn bounds, so its top-left corner is the first pixel
   * drawn rather than `(0, 0)`, and a drawing that starts at `(10, 4)` bakes
   * shifted by that much.
   *
   * The drawing is kept and drawn again after a lost graphics context is
   * restored, so the texture survives one. Calling `update()` on the returned
   * texture's `source` re-uploads it empty and everything drawn from it turns
   * transparent.
   */
  createTexture(
    draw: (g: DrawContext) => void,
    size?: CreateTextureOptions,
  ): TextureResource {
    if (size) {
      assertPositiveNumber("RendererPlugin.createTexture", "width", size.width);
      assertPositiveNumber(
        "RendererPlugin.createTexture",
        "height",
        size.height,
      );
    }
    const pixi = this._app.renderer;
    const graphics = new Graphics();
    draw(graphics);
    const region = size
      ? new Rectangle(0, 0, size.width, size.height)
      : graphics.getLocalBounds().rectangle;
    const resolution = pixi.resolution;
    // One texel is the smallest buffer there is, and a fractional edge is
    // measured in whole texels.
    const width = Math.max(1, Math.max(region.width, 1 / resolution) | 0);
    const height = Math.max(1, Math.max(region.height, 1 / resolution) | 0);
    // The drawing starts wherever it was drawn; the wrapper slides it so the
    // region's top-left corner lands on the texture's.
    const wrapper = new Container();
    wrapper.label = "yage:bakedTexture";
    wrapper.addChild(graphics);
    graphics.position.set(-region.x, -region.y);
    const target = createBakedTarget(
      pixi,
      wrapper,
      {
        width,
        height,
        antialias:
          pixi.view.antialias === true && this.capabilities.maxSamples > 0,
      },
      { stage: this._app.stage, isEnabled: () => this.drawingEnabled },
    );
    const texture = target.texture;
    // The game owns the texture: destroying it frees the drawing behind it.
    texture.once("destroy", () => {
      target.release();
      wrapper.destroy({ children: true });
    });
    return texture;
  }

  /**
   * Create an offscreen buffer that draws `source` into a texture the caller
   * owns and redraws on its own schedule — the repeatable counterpart of
   * {@link createTexture}, with control over when the buffer refreshes and
   * how many texels it gets.
   *
   * For rendering tools that build their own Pixi containers. Game content
   * drawn into a texture goes on a layer declared with `renderTarget`.
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
    return createRenderTarget(
      this._app.renderer,
      source,
      {
        ...options,
        // A context with no multisampled render target draws the buffer the
        // same either way; asking for one only earns a warning per buffer.
        antialias:
          options.antialias === true && this.capabilities.maxSamples > 0,
      },
      {
        stage: this._app.stage,
        isEnabled: () => this.drawingEnabled,
      },
    );
  }

  /** Draw the current stage and pending targets without advancing time. */
  render(): void {
    const enabled = this.drawingEnabled;
    this.drawingEnabled = true;
    try {
      this._app.render();
    } finally {
      this.drawingEnabled = enabled;
    }
  }

  /** Capture the current stage and pending targets without advancing time. */
  captureCanvas(): HTMLCanvasElement {
    const enabled = this.drawingEnabled;
    this.drawingEnabled = true;
    try {
      const renderer = this._app.renderer;
      const texture = renderer.generateTexture(this._app.stage);
      try {
        if (!("gpu" in renderer))
          return renderer.extract.canvas(texture) as HTMLCanvasElement;

        // Pixi's canvas extraction uses the preferred canvas format, which can
        // differ from its BGRA render targets on Linux. A texture copy requires
        // matching formats; the browser converts the canvas for presentation.
        const canvas = document.createElement("canvas");
        canvas.width = texture.source.pixelWidth;
        canvas.height = texture.source.pixelHeight;
        const context = canvas.getContext("webgpu")!;
        const device = renderer.gpu.device;
        context.configure({
          device,
          format: texture.source.format as GPUTextureFormat,
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
          alphaMode: "premultiplied",
        });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToTexture(
          { texture: renderer.texture.getGpuSource(texture.source) },
          { texture: context.getCurrentTexture() },
          { width: canvas.width, height: canvas.height },
        );
        device.queue.submit([encoder.finish()]);
        return canvas;
      } finally {
        texture.destroy(true);
      }
    } finally {
      this.drawingEnabled = enabled;
    }
  }

  // ─── Display ─────────────────────────────────────────────────────

  /**
   * Present the game fullscreen. Resolves once the game is fullscreen, with
   * `screen:fullscreen` already emitted. Resolves without asking the host when
   * the game is fullscreen already, and rejects where
   * {@link fullscreenSupport} is `"unsupported"`.
   *
   * A second call made while a request is in flight shares that request's
   * promise, and a call made while an exit is in flight runs once the exit
   * settles, so the last call wins.
   *
   * On a page this must be called from a user-gesture handler (click, touch,
   * key); the browser rejects the returned promise with a `TypeError`
   * otherwise. It targets the configured `container` when there is one, so DOM
   * overlays beside the canvas stay inside the fullscreened area, and the
   * canvas itself otherwise.
   */
  requestFullscreen(): Promise<void> {
    const part = this._fullscreen;
    if (part === null) {
      return Promise.reject(displayUnavailable("requestFullscreen"));
    }
    if (this._pendingRequest !== null) return this._pendingRequest;
    if (this._pendingExit !== null) {
      const run = (): Promise<void> => this.requestFullscreen();
      return this._pendingExit.then(run, run);
    }
    let support: HostSupport;
    try {
      if (readFullscreenActive(part)) return Promise.resolve();
      support = readFullscreenSupport(part);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    if (support === "unsupported") {
      return Promise.reject(
        new Error(
          "RendererPlugin.requestFullscreen: this host cannot change to " +
            'fullscreen (fullscreenSupport is "unsupported").',
        ),
      );
    }
    const pending: Promise<void> = part.request().then(
      () => {
        this.settleFullscreen(pending);
      },
      (error: unknown) => {
        this.settleFullscreen(pending);
        throw error;
      },
    );
    this._pendingRequest = pending;
    return pending;
  }

  /**
   * Leave fullscreen. Resolves once the game is not fullscreen, with
   * `screen:fullscreen` already emitted. Resolves without asking the host when
   * the game is not fullscreen, so another element's fullscreen is left alone.
   *
   * A second call made while an exit is in flight shares that exit's promise,
   * and a call made while a request is in flight runs once the request
   * settles.
   */
  exitFullscreen(): Promise<void> {
    const part = this._fullscreen;
    if (part === null) {
      return Promise.reject(displayUnavailable("exitFullscreen"));
    }
    if (this._pendingExit !== null) return this._pendingExit;
    if (this._pendingRequest !== null) {
      const run = (): Promise<void> => this.exitFullscreen();
      return this._pendingRequest.then(run, run);
    }
    try {
      if (!readFullscreenActive(part)) return Promise.resolve();
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const pending: Promise<void> = part.exit().then(
      () => {
        this.settleFullscreen(pending);
      },
      (error: unknown) => {
        this.settleFullscreen(pending);
        throw error;
      },
    );
    this._pendingExit = pending;
    return pending;
  }

  /**
   * Whether the game is presented fullscreen. Read live from the host, so it
   * stays accurate when the player leaves fullscreen with Esc, the browser's
   * own control, or a window menu. Another element's fullscreen does not count.
   */
  get isFullscreen(): boolean {
    const part = this._fullscreen;
    if (part === null) throw displayUnavailable("isFullscreen");
    return readFullscreenActive(part);
  }

  /**
   * Whether a fullscreen request can change how the game is presented on this
   * host. `"unsupported"` covers a browser without the Fullscreen API, a frame
   * from another origin without `allow="fullscreen"`, and an app that already
   * opens fullscreen. Hide a fullscreen control where this reads
   * `"unsupported"`, and show it for `"unknown"`.
   */
  get fullscreenSupport(): HostSupport {
    const part = this._fullscreen;
    if (part === null) throw displayUnavailable("fullscreenSupport");
    return readFullscreenSupport(part);
  }

  /**
   * The screen orientation, or `null` where the host cannot read it — typical
   * of headless tests and very old browsers. No order is promised between
   * `screen:orientation` and the canvas taking its new size, so layout code
   * reads the fit getters each frame.
   */
  get orientation(): OrientationType | null {
    const part = this._orientation;
    if (part === null) throw displayUnavailable("orientation");
    return readOrientation(part);
  }

  /**
   * Whether this host can lock the screen orientation. `"unknown"` means the
   * operation exists and only an attempt tells whether this device accepts it:
   * a desktop browser refuses, and Android Chrome accepts while the page is
   * fullscreen or installed.
   */
  get orientationLockSupport(): HostSupport {
    const part = this._orientation;
    if (part === null) throw displayUnavailable("orientationLockSupport");
    return readLockSupport(part);
  }

  /**
   * Lock the screen orientation. Resolves with the orientation the host
   * reports once it accepted the lock, which can differ from `lock` when the
   * device does not turn — compare the two to decide whether to show a
   * rotate-device prompt. Rejects where {@link orientationLockSupport} is
   * `"unsupported"`, and with the host's own error when it refuses.
   */
  lockOrientation(lock: OrientationLock): Promise<OrientationType | null> {
    const part = this._orientation;
    if (part === null) {
      return Promise.reject(displayUnavailable("lockOrientation"));
    }
    let support: HostSupport;
    try {
      support = readLockSupport(part);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    if (support === "unsupported") {
      return Promise.reject(
        new Error(
          "RendererPlugin.lockOrientation: this host cannot lock the screen " +
            'orientation (orientationLockSupport is "unsupported").',
        ),
      );
    }
    return part.lock(lock).then(() => {
      this._syncDisplay();
      return this.orientation;
    });
  }

  /**
   * Release an orientation lock. Resolves without action where
   * {@link orientationLockSupport} is `"unsupported"`.
   */
  unlockOrientation(): Promise<void> {
    const part = this._orientation;
    if (part === null) {
      return Promise.reject(displayUnavailable("unlockOrientation"));
    }
    let support: HostSupport;
    try {
      support = readLockSupport(part);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    if (support === "unsupported") return Promise.resolve();
    return part.unlock();
  }

  /**
   * Drop the settled transition and publish the state the host reports.
   * Clearing first lets a `screen:fullscreen` handler start the next
   * transition rather than join the one that just finished.
   */
  private settleFullscreen(pending: Promise<void>): void {
    if (this._pendingRequest === pending) this._pendingRequest = null;
    if (this._pendingExit === pending) this._pendingExit = null;
    this._syncDisplay();
  }

  /**
   * Read both parts and emit one event per state that moved. Every value is
   * validated before any of it is stored, so a part reporting nonsense leaves
   * the renderer's state as it was. A throwing event handler ends the sequence
   * and reaches whoever caused the read, with the new state already stored.
   */
  private _syncDisplay(): void {
    const fullscreen = this._fullscreen;
    // A host event that arrives after teardown is expected, not an error.
    if (fullscreen === null) return;
    const active = readFullscreenActive(fullscreen);
    const current = this._orientation
      ? readOrientation(this._orientation)
      : null;
    if (active !== this._lastFullscreen) {
      this._lastFullscreen = active;
      this._bus?.emit("screen:fullscreen", { active });
    }
    if (current !== this._lastOrientation) {
      this._lastOrientation = current;
      if (current !== null) {
        this._bus?.emit("screen:orientation", { type: current });
      }
    }
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
      this._config.resolution === undefined,
      // A scene offset is held in virtual pixels; its canvas layers move by
      // it at the new scale. The first fit applies before the provider exists.
      () => {
        if (this._installed.provider) this._provider.reapplyOffsets();
      },
    );
    this._fitController.start();
  }

  /**
   * Resolve the fit target. Returns `null` when no reasonable host element can
   * be inferred — the controller then applies a one-shot transform against
   * `config.width × config.height` without observing. We intentionally do NOT
   * fall through to `document.body`: a `ResizeObserver` on `body` fires on any
   * page layout change (font loads, text reflows, dynamic content), not just
   * viewport resizes, which would silently re-layout the canvas every frame.
   * Callers that want full-page fit must opt in explicitly via
   * `fit: { target: document.body }`.
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

const HOST_SUPPORT_VALUES: readonly string[] = [
  "supported",
  "unsupported",
  "unknown",
];

const ORIENTATION_VALUES: readonly string[] = [
  "portrait-primary",
  "portrait-secondary",
  "landscape-primary",
  "landscape-secondary",
];

/** The error every display member reports outside the engine's run. */
function displayUnavailable(member: string): Error {
  return new Error(
    `RendererPlugin.${member}: the display is only available between ` +
      "engine.start() and engine.destroy().",
  );
}

// A registered display part reports values from a native bridge, so each read
// is checked at that boundary. The page's own parts always pass.

function readFullscreenActive(part: HostFullscreen): boolean {
  const value: unknown = part.active;
  if (typeof value !== "boolean") {
    throw new Error(
      `HostFullscreen.active must be a boolean, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function readFullscreenSupport(part: HostFullscreen): HostSupport {
  const value: unknown = part.support;
  if (!HOST_SUPPORT_VALUES.includes(value as string)) {
    throw new Error(
      "HostFullscreen.support must be one of supported, unsupported, " +
        `unknown, got ${JSON.stringify(value)}.`,
    );
  }
  return value as HostSupport;
}

function readLockSupport(part: HostOrientation): HostSupport {
  const value: unknown = part.lockSupport;
  if (!HOST_SUPPORT_VALUES.includes(value as string)) {
    throw new Error(
      "HostOrientation.lockSupport must be one of supported, unsupported, " +
        `unknown, got ${JSON.stringify(value)}.`,
    );
  }
  return value as HostSupport;
}

function readOrientation(part: HostOrientation): OrientationType | null {
  const value: unknown = part.current;
  if (value === null) return null;
  if (!ORIENTATION_VALUES.includes(value as string)) {
    throw new Error(
      "HostOrientation.current must be one of portrait-primary, " +
        "portrait-secondary, landscape-primary, landscape-secondary or " +
        `null, got ${JSON.stringify(value)}.`,
    );
  }
  return value as OrientationType;
}

/**
 * The backend list Pixi is asked for. A single name keeps its own place at
 * the front and the other backend follows it, so a game that prefers WebGPU
 * still draws where only WebGL exists.
 */
function resolveBackends(preference: unknown): readonly DrawnBackend[] {
  if (preference === undefined) return DRAWN_BACKENDS;
  if (isDrawnBackend(preference)) {
    return [
      preference,
      ...DRAWN_BACKENDS.filter((backend) => backend !== preference),
    ];
  }
  if (
    Array.isArray(preference) &&
    preference.length > 0 &&
    preference.every(isDrawnBackend)
  ) {
    return preference;
  }
  throw new Error(
    'RendererPlugin: pixi.preference must name "webgl" or "webgpu"; YAGE ' +
      "does not draw with Pixi's Canvas 2D renderer. Got " +
      `${JSON.stringify(preference)}.`,
  );
}

function isDrawnBackend(value: unknown): value is DrawnBackend {
  return (
    typeof value === "string" &&
    (DRAWN_BACKENDS as readonly string[]).includes(value)
  );
}
