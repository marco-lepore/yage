import type { SceneTransitionContext } from "@yagejs/core";
import { Container, Graphics } from "pixi.js";
import type { DrawContext } from "../DrawContext.js";
import { assertFiniteNumber } from "../internal/validate.js";
import { attachMask } from "../masks/attachMask.js";
import type { MaskFactory } from "../masks/MaskFactory.js";
import type { MaskHandle } from "../masks/MaskHandle.js";
import { RendererKey } from "../types.js";
import type { VisualBounds } from "../VisualComponent.js";

/** Options for {@link createTransitionOverlay}. */
export interface TransitionOverlayOptions {
  /**
   * `true` covers the whole canvas, letterbox bars included, in canvas
   * pixels. `false` (the default) covers the part of the canvas the game
   * draws on, in virtual pixels: the play area under `letterbox`, the play
   * area and the bars under `expand`.
   */
  coverScreen?: boolean;
}

/**
 * A drawing above every scene, for a transition to cover the swap with: a
 * dip to a colour, a flash, an iris. Created by
 * {@link createTransitionOverlay}; the transition destroys it in `end()`.
 */
export interface TransitionOverlay {
  /**
   * The region the overlay covers, in its own pixels: canvas pixels with
   * `coverScreen`, virtual pixels without. Measured when the overlay is
   * created.
   */
  readonly area: VisualBounds;
  /**
   * Draw on the overlay. Shapes accumulate, so a callback that redraws
   * starts with `g.clear()`. Returns the overlay for chaining.
   */
  draw(fn: (g: DrawContext) => void): this;
  /** Opacity of the whole overlay. Default `1`. A non-finite value throws. */
  alpha: number;
  /** Whether the overlay draws. Default `true`. */
  visible: boolean;
  /**
   * Clip the overlay, replacing any earlier mask. A `graphicsMask` draws in
   * the overlay's own pixels, and `handle.setInverse(true)` keeps the
   * overlay outside the shape, as an iris does.
   */
  setMask(factory: MaskFactory): MaskHandle;
  /** Remove the mask, if any. */
  clearMask(): void;
  /** Remove the overlay and free it. Safe to call repeatedly. */
  destroy(): void;
}

class TransitionOverlayImpl implements TransitionOverlay {
  readonly area: VisualBounds;
  private readonly container = new Container();
  private readonly graphics = new Graphics();
  private mask: MaskHandle | undefined;
  private destroyed = false;

  constructor(parent: Container, area: VisualBounds) {
    this.area = area;
    this.container.label = "yage:transition-overlay";
    this.container.addChild(this.graphics);
    parent.addChild(this.container);
  }

  draw(fn: (g: DrawContext) => void): this {
    fn(this.graphics);
    return this;
  }

  get alpha(): number {
    return this.container.alpha;
  }

  set alpha(value: number) {
    assertFiniteNumber("TransitionOverlay.alpha", "value", value);
    this.container.alpha = value;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(value: boolean) {
    this.container.visible = value;
  }

  setMask(factory: MaskFactory): MaskHandle {
    this.mask?.remove();
    this.mask = attachMask(this.container, factory);
    return this.mask;
  }

  clearMask(): void {
    this.mask?.remove();
    this.mask = undefined;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearMask();
    this.container.removeFromParent();
    this.container.destroy({ children: true });
  }
}

/**
 * Create a drawing above every scene for a custom transition: draw on it in
 * `begin`, animate its `alpha` or mask in `tick`, and `destroy()` it in
 * `end`. The built-in `fade`, `flash` and `iris` cover the swap with one.
 *
 * Without `coverScreen` the overlay sits inside the responsive fit, so its
 * `area` is in virtual pixels and the letterbox bars stay visible. With
 * `coverScreen: true` it covers the bars too, in canvas pixels; convert a
 * virtual point for it with `renderer.virtualToCanvas`.
 *
 * ```ts
 * let overlay: TransitionOverlay | undefined;
 * const dip: SceneTransition = {
 *   duration: 0.4,
 *   begin(ctx) {
 *     overlay = createTransitionOverlay(ctx);
 *     const { x, y, width, height } = overlay.area;
 *     overlay.draw((g) => g.rect(x, y, width, height).fill(0x000000));
 *     overlay.alpha = 0;
 *   },
 *   tick(_dt, ctx) {
 *     if (overlay) overlay.alpha = Math.min(ctx.elapsed / 0.4, 1);
 *   },
 *   end() {
 *     overlay?.destroy();
 *   },
 * };
 * ```
 */
export function createTransitionOverlay(
  ctx: SceneTransitionContext,
  options: TransitionOverlayOptions = {},
): TransitionOverlay {
  const renderer = ctx.engineContext.resolve(RendererKey);
  if (options.coverScreen) {
    // `app.stage` sits at identity, so its children are in canvas pixels.
    const { width, height } = renderer.canvasSize;
    return new TransitionOverlayImpl(renderer.application.stage, {
      x: 0,
      y: 0,
      width,
      height,
    });
  }
  // The world root carries the fit transform and the letterbox clip, which
  // trims an overlay sized to the visible canvas back to the play area.
  const r = renderer.visibleCanvasRect;
  return new TransitionOverlayImpl(renderer.worldRoot, {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  });
}
