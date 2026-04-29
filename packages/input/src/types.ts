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
  /** Deadzone thresholds for analog inputs. */
  deadzones?: {
    /** Radial deadzone applied to stick magnitude (default 0.15). */
    stick?: number;
    /** Lower deadzone for trigger analog values (default 0.05). */
    trigger?: number;
  };
  /**
   * Trigger value at which `GamepadLT`/`GamepadRT` fire as button edges in the
   * action map (default 0.5). Below this, the trigger remains "released" for
   * `isPressed` purposes; the analog `getTrigger` value is unaffected.
   */
  triggerThreshold?: number;
  /**
   * Whether to poll `navigator.getGamepads()` each frame (default `true`).
   * Disable to use only synthetic input via `fireGamepadButton`/`fireGamepadAxis`
   * — useful for inspector probes that want deterministic state.
   */
  pollGamepads?: boolean;
}

/** Information about a connected gamepad. */
export interface GamepadInfo {
  /** Index in `navigator.getGamepads()`. May change if pads are hot-swapped. */
  index: number;
  /** Browser-reported gamepad identifier (vendor + product). */
  id: string;
}

/**
 * Named gamepad analog axis. Sticks are exposed per axis (`leftX`/`leftY`,
 * etc.); triggers (`leftTrigger`/`rightTrigger`) carry the W3C
 * `GamepadButton.value` for buttons 6/7 under standard mapping.
 */
export type GamepadAxisKey =
  | "leftX"
  | "leftY"
  | "rightX"
  | "rightY"
  | "leftTrigger"
  | "rightTrigger";

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
