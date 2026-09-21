import { BlurFilter, Container, Sprite } from "pixi.js";
import type {
  DisplayContainer,
  RendererPlugin,
  RenderTargetHandle,
} from "@yagejs/renderer";
import type { BounceLightOptions } from "./types.js";
import { assertBounce } from "./validation.js";

/**
 * Texels per virtual pixel the blur works in. Pixi reads this as an absolute
 * density rather than a share of whatever it filters, so the blurred copy is
 * a quarter-density picture however sharp the light buffer under it is.
 */
const BOUNCE_RESOLUTION = 0.25;
/** Passes the Gaussian blur makes over that copy. */
const BOUNCE_QUALITY = 6;

/** Options for {@link LightingComposite}. */
export interface LightingCompositeOptions {
  /** The container a renderer draws one scene's light into. */
  source: DisplayContainer;
  /** Screen-space container the finished light is shown in. */
  parent: DisplayContainer;
  /** Buffer width in virtual pixels. */
  width: number;
  /** Buffer height in virtual pixels. */
  height: number;
  /** Light-buffer texel density relative to the canvas. Default `1`. */
  resolutionScale?: number;
  /** Antialias the light buffer. Default `false`. */
  antialias?: boolean;
  /** Bounced light combined with the buffer, or `null` for none. */
  bounce?: BounceLightOptions | null;
  /** Label prefix for the buffers and sprites, shown in the Pixi devtools. */
  label?: string;
}

/**
 * The last step of a lighting renderer: it owns the offscreen buffer the
 * renderer draws one scene's light into, and multiplies that buffer over the
 * scene.
 *
 * With bounce configured, what is multiplied over the scene is the light
 * combined with a blurred, low-resolution copy of itself, which spreads light
 * past shadow edges and around corners the way a lit surface throws light back
 * into a room. The copy is a visual treatment and never reaches
 * `LightingWorld.levelAt()`.
 *
 * A renderer calls {@link invalidate} whenever its light changed and
 * {@link render} once per frame, so nothing is redrawn while the light stands
 * still.
 */
export class LightingComposite {
  private readonly buffer: RenderTargetHandle;
  /** The light buffer plus its blurred copy, or `null` without bounce. */
  private readonly bounced: RenderTargetHandle | null = null;
  private readonly bounceSource: Container | null = null;
  private readonly blur: BlurFilter | null = null;
  /** Every sprite showing a buffer, all stretched over the viewport. */
  private readonly sprites: Sprite[] = [];
  private width: number;
  private height: number;
  private destroyed = false;

  constructor(renderer: RendererPlugin, options: LightingCompositeOptions) {
    const { width, height } = options;
    this.width = width;
    this.height = height;
    const label = options.label ?? "lighting";
    const resolutionScale = options.resolutionScale ?? 1;
    const bounce = options.bounce ?? null;
    if (bounce) assertBounce(bounce, "LightingComposite bounce");

    this.buffer = renderer.createRenderTarget(options.source, {
      width,
      height,
      resolutionScale,
      antialias: options.antialias ?? false,
      clearColor: 0x000000,
      label,
    });

    if (bounce) {
      const sharp = this.addSprite(this.buffer);
      const blurred = this.addSprite(this.buffer);
      this.blur = new BlurFilter({
        // Pixi measures blur strength in the filter's own texels, so a radius
        // in virtual pixels is scaled by the density they are drawn at.
        strength: bounce.radius * BOUNCE_RESOLUTION,
        quality: BOUNCE_QUALITY,
        resolution: BOUNCE_RESOLUTION,
        // Pixi draws a filtered sprite with the filter's blend mode, not the
        // sprite's. "normal" with the alpha below is the mix.
        blendMode: (bounce.blend ?? "max") === "max" ? "max" : "normal",
      });
      blurred.alpha = bounce.strength;
      blurred.filters = [this.blur];
      this.bounceSource = new Container();
      this.bounceSource.label = `${label}:bounce-source`;
      this.bounceSource.addChild(sharp, blurred);
      this.bounced = renderer.createRenderTarget(this.bounceSource, {
        width,
        height,
        resolutionScale,
        clearColor: 0x000000,
        label: `${label}:bounce`,
      });
    }

    const overlay = this.addSprite(this.bounced ?? this.buffer);
    overlay.label = `${label}:overlay`;
    overlay.eventMode = "none";
    overlay.blendMode = "multiply";
    options.parent.addChild(overlay);
  }

  /** Mark the light buffer stale, so the next {@link render} redraws it. */
  invalidate(): void {
    this.buffer.invalidate();
  }

  /**
   * Redraw whatever is stale. Returns whether the light buffer was redrawn,
   * so a caller can skip further work on an unchanged buffer.
   */
  render(): boolean {
    if (!this.buffer.renderIfNeeded()) return false;
    this.bounced?.render();
    return true;
  }

  /** Follow a viewport resize. The light buffer is stale afterwards. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.buffer.resize(width, height);
    this.bounced?.resize(width, height);
    for (const sprite of this.sprites) {
      sprite.width = width;
      sprite.height = height;
    }
  }

  /** Release the buffers and sprites. The source container is left alone. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const sprite of this.sprites) {
      sprite.removeFromParent();
      sprite.destroy();
    }
    this.sprites.length = 0;
    this.blur?.destroy();
    this.bounced?.destroy();
    this.bounceSource?.destroy();
    this.buffer.destroy();
  }

  private addSprite(target: RenderTargetHandle): Sprite {
    const sprite = new Sprite(target.texture);
    sprite.width = this.width;
    sprite.height = this.height;
    this.sprites.push(sprite);
    return sprite;
  }
}
