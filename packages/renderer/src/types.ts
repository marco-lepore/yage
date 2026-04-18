import { ServiceKey } from "@yagejs/core";

/** Service key for the RendererPlugin. */
export const RendererKey = new ServiceKey<
  import("./RendererPlugin.js").RendererPlugin
>("renderer");

/** Configuration for the renderer plugin. */
export interface RendererConfig {
  /** Canvas width in physical pixels. */
  width: number;
  /** Canvas height in physical pixels. */
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
}
