import { ServiceKey } from "@yagejs/core";
import type { Camera } from "./Camera.js";
import type { RenderLayerManager } from "./RenderLayer.js";

// Use lazy import types for PixiJS — these are type-only references
// so no PixiJS runtime code is pulled in.

/** Service key for the RendererPlugin. */
export const RendererKey = new ServiceKey<
  import("./RendererPlugin.js").RendererPlugin
>("renderer");

/** Service key for the PixiJS stage container (world container). */
export const StageKey = new ServiceKey<
  import("pixi.js").Container
>("stage");

/** Service key for the Camera. */
export const CameraKey = new ServiceKey<Camera>("camera");

/** Service key for the RenderLayerManager. */
export const RenderLayerManagerKey = new ServiceKey<RenderLayerManager>(
  "renderLayerManager",
);

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
