import { ServiceKey } from "@yagejs/core";
import type { RendererAdapter } from "@yagejs/core";
import type { InputManager } from "./InputManager.js";

/** Service key for the InputManager. */
export const InputManagerKey = new ServiceKey<InputManager>("inputManager");

/** Minimal camera surface needed by InputManager for pointer world-coord conversion. */
export interface CameraLike {
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

/**
 * Minimal renderer surface needed by InputPlugin for canvas access and
 * coordinate mapping. Alias of the cross-package `RendererAdapter` contract.
 */
export type RendererLike = RendererAdapter;

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
  /**
   * Optional override for the renderer service key. When omitted, InputPlugin
   * auto-resolves `RendererAdapterKey` — the canonical `@yagejs/renderer`
   * plugin registers itself under that key, so pointer events target its
   * canvas and coordinates route through `canvasToVirtual` out of the box.
   * Set this only if you ship a custom renderer registered under a different
   * key.
   */
  rendererKey?: ServiceKey<RendererAdapter>;
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
