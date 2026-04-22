import { ServiceKey } from "@yagejs/core";

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
  /**
   * Optional — convert CSS pixels relative to the canvas into virtual-space
   * pixels. When present, InputPlugin uses it so pointer coordinates stay
   * correct under `fit` scaling or when `virtualWidth`/`virtualHeight` differ
   * from the canvas CSS size.
   */
  canvasToVirtual?(x: number, y: number): { x: number; y: number };
}

/** Configuration for the InputPlugin. */
export interface InputConfig {
  /** Target element for pointer events (default: canvas from renderer, or document). */
  target?: HTMLElement;
  /** Action map: action name -> array of physical key codes. */
  actions?: ActionMapDefinition;
  /** Input groups: group name -> array of action names belonging to it. */
  groups?: Record<string, string[]>;
  /** Key codes to call preventDefault() on (default: none). */
  preventDefaultKeys?: string[];
  /** Service key for the renderer (used to auto-target pointer events to its canvas). */
  rendererKey?: ServiceKey<RendererLike>;
}

/** Maps action names to arrays of physical key codes. */
export type ActionMapDefinition = Record<string, string[]>;

/** How to handle a conflict when rebinding a key already used by another action in the same group. */
export type InputConflictPolicy = "replace" | "keep-both" | "reject";

/** Options for {@link InputManager.rebind}. */
export interface RebindOptions {
  /** Index of the binding slot to replace. Appends if the slot does not exist. */
  slot?: number;
  /** How to resolve conflicts with other actions in the same group(s). Default: `"reject"`. */
  conflict?: InputConflictPolicy;
}

/** Result of a {@link InputManager.rebind} call. */
export interface RebindResult {
  /** Whether the rebind succeeded. */
  ok: boolean;
  /** Present when `ok` is false due to a conflict with `conflict: "reject"`. */
  conflict?: { action: string; key: string };
}
