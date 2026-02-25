import { ServiceKey } from "@yage/core";

/** Service key for the InputManager. */
export const InputManagerKey = new ServiceKey<
  import("./InputManager.js").InputManager
>("inputManager");

/** Minimal camera surface needed by InputManager for pointer world-coord conversion. */
export interface CameraLike {
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

/** Minimal renderer surface needed by InputPlugin for canvas access. */
export interface RendererLike {
  readonly canvas: HTMLCanvasElement;
}

/** Configuration for the InputPlugin. */
export interface InputConfig {
  /** Target element for pointer events (default: canvas from renderer, or document). */
  target?: HTMLElement;
  /** Action map: action name -> array of physical key codes. */
  actions?: ActionMapDefinition;
  /** Key codes to call preventDefault() on (default: none). */
  preventDefaultKeys?: string[];
  /** Service key for the camera (enables pointer world-coordinate conversion). */
  cameraKey?: ServiceKey<CameraLike>;
  /** Service key for the renderer (used to auto-target pointer events to its canvas). */
  rendererKey?: ServiceKey<RendererLike>;
}

/** Maps action names to arrays of physical key codes. */
export type ActionMapDefinition = Record<string, string[]>;
