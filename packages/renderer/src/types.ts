import { ServiceKey } from "@yagejs/core";

/** Service key for the RendererPlugin. */
export const RendererKey = new ServiceKey<
  import("./RendererPlugin.js").RendererPlugin
>("renderer");

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
  pixi?: Record<string, unknown>;
  /**
   * Responsive fit. Defaults to `{ mode: "letterbox" }` against the resolved
   * target (see {@link RendererFitOptions.target}), so the canvas is
   * responsive out of the box — override to change mode or pin to a specific
   * host. See {@link RendererFitOptions}.
   */
  fit?: RendererFitOptions;
}
