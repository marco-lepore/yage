import { ServiceKey } from "@yagejs/core";
import type { RendererPlugin } from "./RendererPlugin.js";
import type { ApplicationOptions, TextStyle } from "./public-types.js";

/** Service key for the RendererPlugin. */
export const RendererKey = new ServiceKey<RendererPlugin>("renderer");

/**
 * Scale mode for the responsive-fit API.
 * - `letterbox` — preserve aspect, fit inside the host, paint bars with the background color.
 * - `expand` — same scaling as `letterbox` (virtual rect always fully visible), but
 *   the bar region is left to the game to draw into. Pair with
 *   `RendererPlugin.extendedVirtualRects` / `visibleCanvasRect` to render fog, parallax,
 *   or a decorative backdrop into the extra space.
 * - `cover` — preserve aspect, fill the host; content overflows the virtual rect on the long axis.
 * - `stretch` — non-uniform scale; the virtual rect is squashed/pulled to match the host.
 */
export type FitMode = "letterbox" | "expand" | "cover" | "stretch";

/** Options for the responsive-fit API. */
export interface RendererFitOptions {
  /** Scale mode. See {@link FitMode}. */
  mode: FitMode;
  /**
   * Element whose size the canvas matches. Defaults, in order:
   * {@link RendererConfig.container}, then `canvas.parentElement`. If neither
   * is available the controller falls back to a one-shot transform against
   * the initial `width × height` and installs no `ResizeObserver` — pass
   * `{ target: document.body }` explicitly for full-page fit.
   */
  target?: HTMLElement;
}

/** Configuration for the renderer plugin. */
export interface RendererConfig {
  /** Initial canvas width in CSS pixels before responsive `fit` takes over. Backing-store size is `width × resolution`. */
  width: number;
  /** Initial canvas height in CSS pixels before responsive `fit` takes over. Backing-store size is `height × resolution`. */
  height: number;
  /** Game coordinate width (default: width). */
  virtualWidth?: number;
  /** Game coordinate height (default: height). */
  virtualHeight?: number;
  /** Background color as a hex number. */
  backgroundColor?: number;
  /** Existing canvas element to use. */
  canvas?: HTMLCanvasElement;
  /** Container element — canvas will be auto-appended here. */
  container?: HTMLElement;
  /** Device pixel ratio. Defaults to `window.devicePixelRatio` for crisp rendering on HiDPI displays. Set to 1 to disable. */
  resolution?: number;
  /** Additional PixiJS Application options. */
  pixi?: Partial<ApplicationOptions>;
  /**
   * Responsive fit. Defaults to `{ mode: "letterbox" }` against the resolved
   * target (see {@link RendererFitOptions.target}), so the canvas is
   * responsive out of the box — override to change mode or pin to a specific
   * host. See {@link RendererFitOptions}.
   */
  fit?: RendererFitOptions;
  /**
   * One-flag preset for pixel-art games. When `true`, the plugin:
   *
   * - Sets `TextureStyle.defaultOptions.scaleMode = "nearest"` so freshly
   *   loaded textures sample without bilinear blur.
   * - Enables `roundPixels` on the Pixi `Application` so subpixel transforms
   *   don't smear sprite edges.
   * - Applies `image-rendering: pixelated` (with `-webkit-optimize-contrast`
   *   for Safari) to the canvas element so the browser scales the backing
   *   store with nearest-neighbor, not bicubic.
   *
   * Composes with `pixi`: explicit `pixi.roundPixels: false` wins over the
   * preset. Default: `false`.
   */
  pixelArtPreset?: boolean;
  /**
   * Engine-level default text style, applied as the base under every
   * `TextComponent` / `UIText` `style` (per-text values win). Lets you set an
   * app-wide font / fill without importing pixi to touch
   * `TextStyle.defaultTextStyle`. `resolution` is not a style property — pass it
   * per `TextComponent`. `@yagejs/ui`'s `UIPlugin({ defaultTextStyle })`
   * can layer a UI-only override on top.
   */
  defaultTextStyle?: TextStyle;
}
