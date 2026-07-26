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
  /** The container drawn into the buffer. */
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
   * Does nothing while the source is hidden (`visible === false`); the
   * request stays pending so the buffer catches up once it is shown.
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

  /** Destroy the texture and its GPU memory. Safe to call repeatedly. */
  destroy(): void;
}

class RenderTargetImpl implements RenderTargetHandle {
  readonly source: DisplayContainer;
  private readonly _renderer: Renderer;
  private readonly _texture: RenderTexture;
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
  private _needsRender = true;

  constructor(
    renderer: Renderer,
    source: DisplayContainer,
    options: RenderTargetOptions,
  ) {
    const scale = options.resolutionScale ?? 1;
    assertPositive(options.width, "width");
    assertPositive(options.height, "height");
    assertPositive(scale, "resolutionScale");

    this._renderer = renderer;
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
  }

  get texture(): TextureResource {
    return this._texture;
  }

  get width(): number {
    return this._texture.width;
  }

  get height(): number {
    return this._texture.height;
  }

  get resolution(): number {
    return this._texture.source.resolution;
  }

  get needsRender(): boolean {
    return this._needsRender;
  }

  invalidate(): void {
    this._needsRender = true;
  }

  render(): void {
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
    if (!this.source.visible) {
      this._needsRender = true;
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
    this._needsRender = false;
  }

  renderIfNeeded(): boolean {
    if (!this._needsRender) return false;
    this.render();
    return !this._needsRender;
  }

  resize(width: number, height: number, resolutionScale?: number): void {
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
    this._needsRender = true;
  }

  destroy(): void {
    this._texture.destroy(true);
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
): RenderTargetHandle {
  return new RenderTargetImpl(renderer, source, options);
}
