import { ServiceKey } from "@yagejs/core";
import type { RendererAdapter, Vec2 } from "@yagejs/core";
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
  /**
   * Invert vertical scroll so positive `dy` means up (default `false`,
   * matching the W3C convention where positive `deltaY` is "scroll content
   * down"). Affects both `onWheel` callbacks and `WheelUp/Down` action edges.
   */
  wheelInvertY?: boolean;
  /**
   * Call `preventDefault()` on incoming wheel events so the page does not
   * scroll. Default `false` — opt in only if your game canvas should swallow
   * scroll. The listener is attached as `{ passive: false }` when this is
   * enabled so `preventDefault()` actually takes effect.
   */
  preventDefaultWheel?: boolean;
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

/**
 * Class of physical pointer device. Sourced from `PointerEvent.pointerType` on
 * real input; defaults to `"mouse"` for synthetic injection.
 */
export type PointerType = "mouse" | "pen" | "touch";

/**
 * Read-only view of a tracked pointer. Returned from {@link InputManager.getPointers}
 * and the per-pointer event hooks. Treat as immutable — fields reflect the
 * pointer's state at query time and are not retained between frames.
 */
export interface PointerInfo {
  /** Browser-assigned `PointerEvent.pointerId`, or the synthetic id passed via `firePointer*`. */
  readonly id: number;
  /** Position in screen-space pixels (already routed through `canvasToVirtual` if available). */
  readonly screenPos: Vec2;
  /** Source device class. */
  readonly type: PointerType;
  /** Whether the browser flagged this as the primary pointer (`PointerEvent.isPrimary`). */
  readonly isPrimary: boolean;
  /** Currently-held button indices (0=left/primary, 1=middle, 2=right). */
  readonly buttons: ReadonlySet<number>;
  /** Convenience mirror of `buttons.size > 0`. */
  readonly isDown: boolean;
}

/**
 * Per-event payload assembled by {@link InputPlugin} from each `PointerEvent`
 * (or by `firePointer*` for synthetic injection) and forwarded to the manager's
 * internal pointer handlers.
 *
 * @internal
 */
export interface PointerEventInfo {
  id: number;
  screenX: number;
  screenY: number;
  type: PointerType;
  isPrimary: boolean;
  /**
   * The button whose state changed for this event. `-1` for events that don't
   * change button state (move-only). Down/up handlers ignore `-1`.
   */
  button: number;
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
