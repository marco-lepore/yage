// Focus coverage exemptions live here, as
// `// focus-coverage-exempt: <Component> — <reason>`.
// Every interactive element in packages/ui/src/types.ts reaches FocusProps,
// and every element whose props reach FocusProps builds a FocusState, unless
// it is listed here with a reason.

import type {
  FocusDirection,
  FocusNeighbors,
  FocusProps,
  UIElement,
} from "../types.js";
import type { UIFocusScope } from "./UIFocusScope.js";
import { releasePointerRequest } from "./pointer-request.js";
import { runUICallback } from "../error-boundary.js";

/**
 * What an element hands its own {@link FocusState}: the parts of focus only
 * the element can answer for.
 */
export interface FocusBehavior {
  /**
   * Whether this kind of element takes focus when the game says nothing.
   * `true` for the pressable primitives, `false` for a panel or a label.
   */
  readonly focusableByDefault: boolean;
  /** Whether the element refuses focus and activation right now. */
  isDisabled?(): boolean;
  /** Paint the focused or the resting look. */
  paint?(focused: boolean): void;
  /**
   * Paint the pressed or the unpressed look. Receives the combined press of
   * every device holding the element, so the resting look returns only once
   * the pointer has also let go. `true` can arrive more than once, so set the
   * face; do not toggle it. An element with no pressed look leaves this out.
   */
  setPressed?(pressed: boolean): void;
  /** Run the element's own action, the one a click also runs. */
  activate?(): void;
  /**
   * Step the element's own value along `direction`, returning `true` only
   * when the press was consumed. A stepper at its end returns `false`, so the
   * press moves focus out instead of being swallowed.
   */
  adjust?(direction: FocusDirection): boolean;
}

/**
 * Every element's focus state, keyed by the element. This package holds
 * per-element state in module-level tables (`error-boundary.ts`,
 * `focus/scroll-registry.ts`, `focus/input-capture.ts`), not in slots on the
 * public `UIElement` interface.
 */
const states = new WeakMap<UIElement, FocusState>();

/**
 * The focus state of one element: what a scope reads to decide whether the
 * element is a candidate, and where the element's own focus callbacks live.
 *
 * Built by the element itself, one per element. The element calls
 * {@link FocusState.destroy} from its own `destroy()`.
 */
export class FocusState {
  /** The element's own hooks, which a scope drives it through. @internal */
  readonly behavior: FocusBehavior;

  private readonly element: UIElement;
  private _focusable: boolean | undefined;
  private _id: string | undefined;
  private _neighbors: FocusNeighbors | undefined;
  private _onFocusChange: ((focused: boolean) => void) | undefined;
  private _onAdjust: ((direction: -1 | 1) => void) | undefined;
  private _focused = false;
  private _scope: UIFocusScope | null = null;

  constructor(element: UIElement, props: FocusProps, behavior: FocusBehavior) {
    this.element = element;
    this.behavior = behavior;
    this._focusable = props.focusable;
    this._id = props.focusId;
    this._neighbors = props.focusNeighbors;
    this._onFocusChange = props.onFocusChange;
    this._onAdjust = props.onAdjust;
    states.set(element, this);
  }

  /** Whether the element takes part in focus navigation. */
  get focusable(): boolean {
    return this._focusable ?? this.behavior.focusableByDefault;
  }

  /** Whether the element holds focus in the scope that owns it. */
  get focused(): boolean {
    return this._focused;
  }

  /** The name a sibling's `focusNeighbors` points at. */
  get id(): string | undefined {
    return this._id;
  }

  /** Per-direction overrides of the position rule. */
  get neighbors(): FocusNeighbors | undefined {
    return this._neighbors;
  }

  /** Whether the element refuses focus and activation right now. @internal */
  get disabled(): boolean {
    return this.behavior.isDisabled?.() === true;
  }

  /**
   * Swap focus props in place, from the element's `update()`. A present key
   * reassigns, including the explicit `undefined` the React reconciler emits
   * for a removed prop. An absent key leaves the field alone.
   */
  set(props: FocusProps): void {
    if ("focusable" in props) this._focusable = props.focusable;
    if ("focusId" in props) this._id = props.focusId;
    if ("focusNeighbors" in props) this._neighbors = props.focusNeighbors;
    if ("onFocusChange" in props) this._onFocusChange = props.onFocusChange;
    if ("onAdjust" in props) this._onAdjust = props.onAdjust;
  }

  /**
   * Record that focus arrived or left, paint it, then tell the game, so a
   * throwing callback cannot leave the flag and the paint apart.
   * @internal
   */
  _setFocused(focused: boolean): void {
    if (focused === this._focused) return;
    this._focused = focused;
    this.behavior.paint?.(focused);
    const onFocusChange = this._onFocusChange;
    if (onFocusChange) {
      runUICallback(this.element.displayObject, "UI onFocusChange", () =>
        onFocusChange(focused),
      );
    }
  }

  /**
   * Step along `direction`, reporting whether the press was consumed and so
   * must not move focus. The game's `onAdjust` owns left and right when set;
   * the element's own stepper owns everything else. The two never both run.
   * @internal
   */
  _adjust(direction: FocusDirection): boolean {
    const onAdjust = this._onAdjust;
    if (onAdjust && (direction === "left" || direction === "right")) {
      const step = direction === "left" ? -1 : 1;
      runUICallback(this.element.displayObject, "UI onAdjust", () =>
        onAdjust(step),
      );
      return true;
    }
    return this.behavior.adjust?.(direction) === true;
  }

  /** Remember the scope holding this element. @internal */
  _setScope(scope: UIFocusScope | null): void {
    this._scope = scope;
  }

  /**
   * Leave focus navigation, from the element's own `destroy()`. The owning
   * scope drops the element with no callback and no repaint, and a pending
   * pointer request from this element is dropped too.
   */
  destroy(): void {
    releasePointerRequest(this.element);
    this._scope?._clearFocusedOnDestroy(this.element);
    this._scope = null;
    this._focused = false;
    this._neighbors = undefined;
    states.delete(this.element);
  }
}

/**
 * The focus state an element built for itself, or `undefined` for one that
 * takes no part in focus navigation.
 * @internal
 */
export function getFocusState(element: UIElement): FocusState | undefined {
  return states.get(element);
}
