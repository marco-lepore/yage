import { Color, RenderTexture } from "pixi.js";
import type { Renderer } from "pixi.js";
import type {
  ColorValue,
  DisplayContainer,
  TextureResource,
} from "./public-types.js";

/** Options for `RendererPlugin.createRenderTarget`. */
export interface RenderTargetOptions {
  /** Buffer width, in the source container's own coordinates. */
  width: number;
  /** Buffer height, in the source container's own coordinates. */
  height: number;
  /**
   * Texel density as a fraction of the renderer's own resolution. `1`
   * (the default) gives the buffer the same sharpness as the canvas; `0.5`
   * allocates a quarter of the texels and stretches them back over the same
   * area.
   *
   * The texture still measures `width × height` whatever the value, so
   * lowering it costs sharpness and never layout. Worth doing for content
   * that is already soft — gradients, blurred glows — and not for text or
   * pixel art.
   */
  resolutionScale?: number;
  /** Antialias the buffer's own edges. Default `false`. */
  antialias?: boolean;
  /** Colour the buffer is cleared to before each render. Default: transparent. */
  clearColor?: ColorValue;
  /** Label on the underlying texture, shown in the Pixi devtools. */
  label?: string;
  /** Targets sampled by this pass. Drawing waits until these targets are clean. */
  dependsOn?: readonly RenderTargetHandle[];
  /**
   * Re-allocate the buffer at the renderer's new resolution when that
   * changes (a window moved to a display with another pixel ratio, a browser
   * zoom) and redraw it from the source at the next frame. Default `false`:
   * the buffer keeps the density it was created or last resized with.
   */
  followResolution?: boolean;
}

/** How often a render-target layer redraws its texture. */
export type LayerRenderRefresh = "every-frame" | "on-demand";

/**
 * Options for a layer that draws into a texture, set as `LayerDef.renderTarget`.
 */
export interface LayerRenderTargetOptions extends Pick<
  RenderTargetOptions,
  "resolutionScale" | "antialias" | "clearColor" | "label"
> {
  /** Texture width, in the layer's pixels. */
  width: number;
  /** Texture height, in the layer's pixels. */
  height: number;
  /**
   * Register the texture under this key while the scene lives, so a
   * `SpriteComponent` shows it with `texture: key`. Scene exit unregisters it.
   * When two live scenes register the same key, the key resolves the later
   * scene's texture, and goes back to the earlier one's when the later scene
   * exits. A key used by a loaded asset throws when the scene enters.
   */
  texture?: string;
  /**
   * `"every-frame"` (the default) redraws the texture each frame, also
   * while the scene is hidden under another, since another scene can show
   * the texture by key.
   * `"on-demand"` redraws it only on the frame after
   * `layer.renderTarget.invalidate()`, for content that changes rarely.
   */
  refresh?: LayerRenderRefresh;
}

/**
 * The texture a render-target layer draws into, on `RenderLayer.renderTarget`.
 * The scene owns it: scene exit destroys it with the layer.
 *
 * The texture is redrawn just before the frame is drawn, after every visual
 * on the layer has taken its entity's `Transform`, so it never shows the
 * previous frame. The layer's own pixels are the texture's pixels: a visual
 * at `(100, 50)` on the layer lands at texture pixel `(100, 50)`.
 */
export interface LayerRenderTarget {
  /** The texture the layer draws into. Show it with a `SpriteComponent`, a mask, or a filter. */
  readonly texture: TextureResource;
  /** Texture width in the layer's pixels. */
  readonly width: number;
  /** Texture height in the layer's pixels. */
  readonly height: number;
  /** Texels per layer pixel actually allocated: the renderer's resolution times `resolutionScale`. */
  readonly resolution: number;
  /** Whether a redraw is pending for the next frame. */
  readonly needsRender: boolean;
  /** Redraw the texture on the next frame. Needed only with `refresh: "on-demand"`. */
  invalidate(): void;
  /**
   * Resize the texture and redraw it on the next frame. Anything already
   * showing the texture picks up the new size on its next draw.
   */
  resize(width: number, height: number, resolutionScale?: number): void;
}

/**
 * An offscreen texture the game draws into on its own schedule, returned by
 * `RendererPlugin.createRenderTarget`.
 *
 * The buffer starts out needing a render and is redrawn only when the game
 * asks — call {@link renderIfNeeded} every frame and {@link invalidate}
 * whenever the source content changes, or call {@link render} directly for a
 * buffer that must follow moving content.
 *
 * Drawing happens in the source container's own coordinate space: a child at
 * local `(100, 50)` lands at texture pixel `(100, 50)`. Ancestor transforms
 * do not reach the buffer, so neither the camera nor the responsive-fit
 * scale moves or scales what is drawn. Position the source's children in the
 * space you want the texture to hold.
 *
 * Keep the source out of the live scene graph. Pixi promotes a rendered
 * container to a render group, which changes how it batches where it is
 * parented, and content drawn into a buffer is normally shown through the
 * buffer's texture rather than twice.
 */
export interface RenderTargetHandle {
  /** The texture the buffer draws into. Show it with a `SpriteComponent`, a mask, or a filter. */
  readonly texture: TextureResource;
  /**
   * The container drawn into the buffer. The game owns it: {@link destroy}
   * frees the texture and leaves this container alone.
   */
  readonly source: DisplayContainer;
  /** Buffer width in source coordinates. */
  readonly width: number;
  /** Buffer height in source coordinates. */
  readonly height: number;
  /** Texels per source pixel actually allocated — the renderer's resolution times `resolutionScale`. */
  readonly resolution: number;
  /** Whether a render is pending. */
  readonly needsRender: boolean;

  /** Mark the buffer stale so the next {@link renderIfNeeded} redraws it. */
  invalidate(): void;

  /**
   * Draw the source into the buffer now and clear the pending flag.
   * Defers while the source is hidden, an input target is pending, or drawing is disabled.
   * The request stays pending until an allowed draw or explicit stage capture.
   * Deferred targets flush in creation order; create inputs before consumers.
   */
  render(): void;

  /**
   * Draw the source only when a render is pending. Returns whether it drew,
   * so a caller can skip downstream work on an unchanged buffer.
   */
  renderIfNeeded(): boolean;

  /**
   * Resize the buffer and mark it stale. Anything already showing the
   * texture picks up the new size on its next draw.
   */
  resize(width: number, height: number, resolutionScale?: number): void;

  /**
   * Destroy the texture and its GPU memory. Safe to call repeatedly. Frees
   * the texture only: destroy the source container yourself, and call
   * `unregisterTexture(key)` for any key the texture was registered under, or
   * that key keeps resolving a destroyed texture. `engine.destroy()` leaves
   * the texture to the game, so this call frees it after the engine is gone
   * too.
   */
  destroy(): void;
}

/** One of Pixi's own dispatch lists, which a target joins and leaves. */
interface PixiRunner {
  add(item: unknown): unknown;
  remove(item: unknown): unknown;
}

/** @internal Drawing policy supplied by the owning renderer. */
export interface RenderTargetDrawing {
  readonly stage: DisplayContainer;
  isEnabled(): boolean;
  /**
   * Set for a render-target layer: draw before each stage render, every
   * time or only while a render is pending.
   */
  readonly refresh?: LayerRenderRefresh;
  /**
   * Every target built with this policy and not yet destroyed. Before Pixi
   * destroys the runners these targets joined, the renderer calls `release()`
   * on each one.
   */
  readonly live: Set<{ release(): void }>;
}

class RenderTargetImpl implements RenderTargetHandle, LayerRenderTarget {
  readonly source: DisplayContainer;
  private readonly _renderer: Renderer;
  private readonly _texture: RenderTexture;
  private readonly _dependencies: readonly RenderTargetHandle[];
  /**
   * Pre-converted to RGBA. Pixi only normalises a *truthy* `clearColor`, so a
   * numeric `0x000000` would reach the backend as a bare number where an array
   * is expected and clear to undefined channels.
   */
  private readonly _clearColor: number[] | undefined;
  /**
   * Kept so `resize` can re-derive the texture resolution from the renderer's
   * current one. Storing only the absolute resolution would silently pin the
   * buffer to whatever the renderer happened to be at construction time.
   */
  private _resolutionScale: number;
  private _state: "clean" | "dirty" | "deferred" = "dirty";
  private _destroyed = false;
  /** Pixi runners this target joined, so teardown leaves every one of them. */
  private readonly _runners: PixiRunner[] = [];
  /**
   * Whether `destroy` frees the texture. A buffer the renderer bakes hands
   * its texture to the game, which destroys it when it is done with it.
   */
  private readonly _ownsTexture: boolean;

  constructor(
    renderer: Renderer,
    source: DisplayContainer,
    options: RenderTargetOptions,
    private readonly drawing?: RenderTargetDrawing,
    ownsTexture = true,
  ) {
    if (source === drawing?.stage) {
      throw new Error(
        "createRenderTarget: source must not be the application stage.",
      );
    }
    const scale = options.resolutionScale ?? 1;
    assertPositive(options.width, "width");
    assertPositive(options.height, "height");
    assertPositive(scale, "resolutionScale");

    this._renderer = renderer;
    this._ownsTexture = ownsTexture;
    this._dependencies = [...(options.dependsOn ?? [])];
    this.source = source;
    this._resolutionScale = scale;
    this._clearColor =
      options.clearColor !== undefined
        ? // `toArray` may hand back a Float32Array; the render options want a
          // plain array.
          Array.from(new Color(options.clearColor).toArray())
        : undefined;
    this._texture = RenderTexture.create({
      width: options.width,
      height: options.height,
      resolution: renderer.resolution * scale,
      antialias: options.antialias ?? false,
      // Lets anything showing the texture re-read its size after `resize`.
      dynamic: true,
      ...(options.label !== undefined ? { label: options.label } : undefined),
    });
    if (drawing) {
      this.join(renderer.runners.prerender);
      this.join(renderer.runners.contextChange);
      if (options.followResolution) {
        this.join(renderer.runners.resolutionChange);
      }
      drawing.live.add(this);
    }
  }

  /** Pixi's existing pre-render dispatch flushes targets in creation order. */
  prerender(options: { container: DisplayContainer }): void {
    if (options.container !== this.drawing?.stage) return;
    const refresh = this.drawing.refresh;
    if (refresh === "every-frame") this.invalidate();
    if (refresh ? this._state !== "clean" : this._state === "deferred") {
      this.draw(true);
    }
  }

  /**
   * A replacement graphics context holds none of the pixels the old one did,
   * so the buffer is drawn again from its source at the next frame.
   */
  contextChange(): void {
    this._state = "deferred";
  }

  /**
   * Keep the buffer's texel density as the canvas changes its own, so what it
   * holds stays as sharp as the canvas it is shown on.
   */
  resolutionChange(): void {
    this.resize(this._texture.width, this._texture.height);
    this._state = "deferred";
  }

  /** Draw the source into the buffer now, whatever drawing is enabled. */
  drawNow(): void {
    this.draw(true);
  }

  private join(runner: PixiRunner): void {
    runner.add(this);
    this._runners.push(runner);
  }

  get texture(): TextureResource {
    this._assertLive("texture");
    return this._texture;
  }

  get width(): number {
    this._assertLive("width");
    return this._texture.width;
  }

  get height(): number {
    this._assertLive("height");
    return this._texture.height;
  }

  get resolution(): number {
    this._assertLive("resolution");
    return this._texture.source.resolution;
  }

  get needsRender(): boolean {
    return this._state !== "clean";
  }

  invalidate(): void {
    if (this._state === "clean") this._state = "dirty";
  }

  render(): void {
    this.draw(false);
  }

  private draw(force: boolean): void {
    this._assertLive("render");
    // Pixi tears out the transform fields on destroy, so drawing a destroyed
    // source throws from deep inside its own update with nothing naming the
    // real mistake. Skipping instead would leave a permanently stale buffer.
    if (this.source.destroyed) {
      throw new Error(
        "RenderTarget: the source container has been destroyed, so this buffer " +
          "can never draw again. Destroy the target alongside its source.",
      );
    }
    // Pixi draws nothing for a hidden container, which would leave the buffer
    // silently stale. Leave the request pending so it catches up once the
    // source is shown again — including a forced render on a clean target,
    // which would otherwise be dropped with nothing left to replay it.
    if (
      !this.source.visible ||
      this._dependencies.some((target) => target.needsRender) ||
      (!force && this.drawing?.isEnabled() === false)
    ) {
      this._state = "deferred";
      return;
    }
    this._renderer.render({
      container: this.source,
      target: this._texture,
      clear: true,
      ...(this._clearColor !== undefined
        ? { clearColor: this._clearColor }
        : undefined),
    });
    this._state = "clean";
  }

  renderIfNeeded(): boolean {
    if (!this.needsRender) return false;
    this.render();
    return !this.needsRender;
  }

  resize(width: number, height: number, resolutionScale?: number): void {
    this._assertLive("resize");
    assertPositive(width, "width");
    assertPositive(height, "height");
    if (resolutionScale !== undefined) {
      assertPositive(resolutionScale, "resolutionScale");
      this._resolutionScale = resolutionScale;
    }
    // Always re-derive from the renderer's current resolution, so a buffer
    // keeps the density it was asked for rather than the absolute one it
    // happened to get at construction.
    this._texture.resize(
      width,
      height,
      this._renderer.resolution * this._resolutionScale,
    );
    if (this._state === "clean") this._state = "dirty";
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.release();
    if (this._ownsTexture) this._texture.destroy(true);
  }

  /**
   * Stop following the renderer: leave every Pixi runner this target joined.
   * The texture stays with whoever owns it, so a `destroy()` after the
   * renderer is gone still frees it.
   */
  release(): void {
    for (const runner of this._runners) runner.remove(this);
    this._runners.length = 0;
    this.drawing?.live.delete(this);
  }

  /**
   * Every member but `destroy` reads through the texture, which Pixi empties
   * out on destroy. Without this the read fails as a bare
   * `Cannot read properties of null` from inside Pixi.
   */
  private _assertLive(member: string): void {
    if (!this._destroyed) return;
    throw new Error(
      `RenderTargetHandle.${member}: the handle is destroyed. ` +
        `Create a new render target instead of reusing a destroyed one.`,
    );
  }
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `createRenderTarget: ${name} must be a positive number, got ${value}.`,
    );
  }
}

/**
 * Build a render target around `source`. Reached through
 * `RendererPlugin.createRenderTarget`, which supplies the live renderer.
 */
export function createRenderTarget(
  renderer: Renderer,
  source: DisplayContainer,
  options: RenderTargetOptions,
  drawing?: RenderTargetDrawing,
): RenderTargetHandle {
  return new RenderTargetImpl(renderer, source, options, drawing);
}

/** @internal A buffer whose texture belongs to the game that asked for it. */
export interface BakedTargetHandle {
  /** The texture the drawing was baked into. */
  readonly texture: TextureResource;
  /** Stop following the renderer, leaving the texture to its owner. */
  release(): void;
}

/**
 * @internal Bake `source` into a texture at once and keep drawing it again
 * whenever the graphics context is replaced. Reached through
 * `RendererPlugin.createTexture`, which keeps the drawing as the source.
 */
export function createBakedTarget(
  renderer: Renderer,
  source: DisplayContainer,
  options: RenderTargetOptions,
  drawing: RenderTargetDrawing,
): BakedTargetHandle {
  const target = new RenderTargetImpl(
    renderer,
    source,
    options,
    drawing,
    false,
  );
  target.drawNow();
  return {
    texture: target.texture,
    release: () => target.destroy(),
  };
}

/**
 * Builds the target a render-target layer draws into. The renderer plugin
 * passes `SceneRenderTreeProviderImpl` one bound to the live renderer; a
 * render tree without one cannot hold a render-target layer.
 */
export type LayerTargetFactory = (
  source: DisplayContainer,
  options: LayerRenderTargetOptions,
) => RenderTargetHandle;
