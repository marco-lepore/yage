import { ServiceKey } from "@yagejs/core";

/** Service key for the RendererPlugin. */
export const RendererKey = new ServiceKey<
  import("./RendererPlugin.js").RendererPlugin
>("renderer");

/**
 * Scale mode for the responsive-fit API.
 * - `letterbox` — preserve aspect, fit inside the host, paint bars with the background color.
 * - `cover` — preserve aspect, fill the host; content overflows the virtual rect on the long axis.
 * - `stretch` — non-uniform scale; the virtual rect is squashed/pulled to match the host.
 */
export type FitMode = "letterbox" | "cover" | "stretch";

/** Options for the responsive-fit API. */
export interface RendererFitOptions {
  /** Scale mode. See {@link FitMode}. */
  mode: FitMode;
  /**
   * Element whose size the canvas matches. Defaults, in order:
   * {@link RendererConfig.container}, then `canvas.parentElement`, then `document.body`.
   */
  target?: HTMLElement;
}

/** Configuration for the renderer plugin. */
export interface RendererConfig {
  /** Canvas width in physical pixels. Also the initial CSS size before `fit` takes over. */
  width: number;
  /** Canvas height in physical pixels. Also the initial CSS size before `fit` takes over. */
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
   * Responsive fit. If omitted, the canvas keeps its initial `width × height`.
   * If set, the canvas tracks the target element and re-maps the virtual
   * rectangle on every resize. See {@link RendererFitOptions}.
   */
  fit?: RendererFitOptions;
}
