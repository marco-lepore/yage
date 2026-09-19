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
   * Paint the pressed or the unpressed look. An element paints pressed while
   * any device holds it down, and the scope's confirm press is one of those
   * devices, so this hook is told the combined press rather than the scope's
   * alone: the element gives its resting look back only once the pointer has
   * also let go. `true` arrives more than once where the element repaints
   * itself under a press that is still held, so an implementation sets the
   * face rather than toggling it.
   *
   * An element whose look has no pressed face — a panel, a widget whose art
   * names only a resting one — leaves this out, so a confirm press on it
   * paints nothing.
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
 * Every element's focus state, keyed by the element.
 *
 * A module-level table is how this package holds state about an element
 * outside the `UIElement` interface: error boundaries (`error-boundary.ts`),
 * scroll views (`focus/scroll-registry.ts`), elements holding a scope's input
 * (`focus/input-capture.ts`) and scope hosts (`focus/UIFocusScope.ts`) are
 * all reached this way. The internal members `UIElement` does carry are hooks an
 * element implements for itself, so a slot this package wrote into an element
 * would be a second convention beside the table, and a writable one, since
 * the interface is public. {@link FocusState.destroy} drops the entry, so a
 * destroyed element stops being a focus candidate.
 */
const states = new WeakMap<UIElement, FocusState>();

/**
 * The focus state of one element: what a scope reads to decide whether the
 * element is a candidate, and where the element's own focus callbacks live.
 *
 * One instance per element, built by the element itself and registered in a
 * module-level map so a scope reaches it without a required member on
 * {@link UIElement}. Callbacks sit in mutable fields swapped in place by
 * {@link FocusState.set}, so the React reconciler's prop churn never rebinds
 * anything. Teardown is explicit: the element calls {@link FocusState.destroy}
 * from its own `destroy()`.
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
   * Swap focus props in place, from the element's `update()`. Reads key
   * presence the way the shared pointer fan-out does: a present key —
   * including the explicit `undefined` the React reconciler emits for a
   * removed prop — reassigns, while an absent key leaves the field alone, so
   * a partial imperative `update({ ... })` drops no handler.
   */
  set(props: FocusProps): void {
    if ("focusable" in props) this._focusable = props.focusable;
    if ("focusId" in props) this._id = props.focusId;
    if ("focusNeighbors" in props) this._neighbors = props.focusNeighbors;
    if ("onFocusChange" in props) this._onFocusChange = props.onFocusChange;
    if ("onAdjust" in props) this._onAdjust = props.onAdjust;
  }

  /**
   * Record that focus arrived or left, paint it, and tell the game, in that
   * order, so a throwing callback cannot leave the flag and the paint
   * disagreeing. Repeated calls with the value already held do nothing.
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
   * must not move focus.
   *
   * The game's `onAdjust` owns left and right, which is what a volume or
   * difficulty row is written as; the element's own stepper owns every other
   * axis it claims, and left and right when the game supplied no handler. The
   * two never both run.
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
   * Leave focus navigation. Called from the element's own `destroy()`: the
   * owning scope drops the element with no callback and no repaint, because
   * painting from here would reach a freed Yoga node and a destroyed
   * container. A pointer request this element left in the shared cell goes
   * with it, so no scope reads it on a later frame.
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
