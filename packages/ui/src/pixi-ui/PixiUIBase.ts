import type { DisplayContainer } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode } from "yoga-layout";
import type {
  FocusDirection,
  FocusProps,
  LayoutProps,
  PointerEventProps,
  UIElement,
} from "../types.js";
import { createYogaNode, applyLayoutProps } from "../yoga-helpers.js";
import { runUICallback } from "../error-boundary.js";
import { PointerEvents } from "../pointer-events.js";
import { FocusOutline } from "../internal/focus-outline.js";
import type { UIFocusOutlineBox } from "../types.js";
import { FocusState } from "../focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "../focus/pointer-request.js";

/**
 * Abstract base class for wrapping @pixi/ui components as Yoga-aware UIElements.
 *
 * Handles: Yoga node + measure function, prevProps storage, bridgeSignal helper,
 * visible prop, applyLayout, hover fan-out, focus, and destroy cleanup.
 */
export abstract class PixiUIBase<
  T extends DisplayContainer,
> implements UIElement {
  readonly yogaNode: YogaNode;
  protected readonly view: T;
  protected prevProps: Record<string, unknown> = {};
  private readonly bridgedCallbacks = new Map<
    string,
    Map<(...args: never[]) => void, (...args: never[]) => void>
  >();
  private readonly pointerEvents: PointerEvents | undefined;
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;
  private _focused = false;
  private _isHovered = false;
  // One flag per device holding the widget down, and whether this wrapper is
  // the one showing the pressed face. The widget paints its own pointer
  // press; this wrapper paints a confirm press.
  private _pointerPressed = false;
  private _focusPressed = false;
  private _paintedPressed = false;
  private _destroyed = false;

  get displayObject(): DisplayContainer {
    return this.view;
  }

  get visible(): boolean {
    return this.view.visible;
  }

  set visible(v: boolean) {
    this.view.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  constructor(view: T, props: LayoutProps & PointerEventProps & FocusProps) {
    this.view = view;
    this.yogaNode = createYogaNode();

    this.yogaNode.setMeasureFunc((w, wMode, h, hMode) => {
      const { width: natW, height: natH } = this.intrinsicSize();

      let mW = natW;
      let mH = natH;

      if (wMode === MeasureMode.Exactly) mW = w;
      else if (wMode === MeasureMode.AtMost) mW = Math.min(natW, w);

      if (hMode === MeasureMode.Exactly) mH = h;
      else if (hMode === MeasureMode.AtMost) mH = Math.min(natH, h);

      return { width: mW, height: mH };
    });

    applyLayoutProps(this.yogaNode, props);
    if (props.visible === false) this.visible = false;

    if (this.interactive) {
      // The hover listeners also keep {@link hovered}.
      this.view.on("pointerover", () => {
        if (this.disabled) return;
        this._isHovered = true;
        requestHoverFocus(this);
      });
      this.view.on("pointerout", () => {
        if (this.disabled) return;
        this._isHovered = false;
        this._pointerPressed = false;
        this._paintPress();
      });
      this.view.on("pointerdown", () => {
        if (this.disabled) return;
        requestPressFocus(this);
        // No paint: the widget shows its own pressed face for the pointer.
        this._pointerPressed = true;
      });
      this.view.on("pointerup", () => {
        this._pointerPressed = false;
        this._paintPress();
      });
      this.view.on("pointerupoutside", () => {
        this._pointerPressed = false;
        this._paintPress();
      });

      // A @pixi/ui widget swaps its own face whenever the pointer leaves it
      // or lets go, knowing nothing of a confirm press held from a focus
      // scope, so the face is reclaimed after each of those swaps. A reclaim
      // only works from a listener that runs after the widget's own. The
      // pointer listeners above do, since @pixi/ui connects before this
      // constructor. These cover a widget reading the mouse names: Pixi
      // dispatches each mouse event after the pointer one it accompanies.
      const reclaimFace = (): void => this._paintPress();
      this.view.on("mouseover", reclaimFace);
      this.view.on("mouseout", reclaimFace);
      this.view.on("mouseup", reclaimFace);
      this.view.on("mouseupoutside", reclaimFace);

      // The caller's hover callbacks are suppressed while the widget is
      // disabled.
      this.pointerEvents = new PointerEvents(
        this.view,
        props,
        () => this.disabled,
      );
    }

    this._focusOutline = new FocusOutline({
      container: this.view,
      box: () => this.focusOutlineBox(),
      scale: () => this.view.scale,
    });
    this._focusOutline.set(props);

    this._focus = new FocusState(this, props, {
      focusableByDefault: this.interactive,
      isDisabled: () => this.disabled,
      paint: (focused) => this._paintFocus(focused),
      setPressed: (pressed) => {
        this._focusPressed = pressed;
        this._paintPress();
      },
      activate: () => {
        this.activate();
        // The widget's own action leaves it on the released face, which is
        // wrong while a pointer still holds it down.
        this._paintPress();
      },
      adjust: (direction) => this.adjust?.(direction) === true,
    });
  }

  /**
   * Whether the wrapped widget answers the player. One that only displays a
   * value keeps its view's own event mode and stays out of navigation unless
   * `focusable` asks for it.
   */
  protected get interactive(): boolean {
    return true;
  }

  /**
   * Whether the widget refuses the pointer and a confirm press. Only a widget
   * whose @pixi/ui view carries an enabled flag reports `true`.
   */
  get disabled(): boolean {
    return false;
  }

  /** Whether the widget holds focus in the scope that owns it. */
  get focused(): boolean {
    return this._focused;
  }

  /** Whether the pointer is over the widget. */
  protected get hovered(): boolean {
    return this._isHovered;
  }

  /**
   * Whether any device is holding the widget down: the pointer, a confirm
   * press from a focus scope, or both.
   */
  protected get pressed(): boolean {
    return this._pointerPressed || this._focusPressed;
  }

  /** Whether the widget takes part in focus navigation. */
  get focusable(): boolean {
    return this._focus.focusable;
  }

  /**
   * Run the widget's own action, as a confirm press or a click does. A widget
   * that is stepped rather than pressed implements this as a no-op and
   * carries {@link adjust}.
   */
  abstract activate(): void;

  /**
   * Show the widget's pressed face while a device holds it down, and its
   * resting face once every device has let go. A widget with no pressed face
   * leaves it out.
   *
   * `true` arrives again where the widget has repainted itself under a press
   * that is still held, so an implementation sets the face and never toggles
   * it.
   */
  protected setPressed?(pressed: boolean): void;

  /**
   * Step the widget's own value along `direction`, returning `true` only when
   * the press was consumed. A stepper at its end returns `false`, so the press
   * moves focus out of the widget.
   */
  protected adjust?(direction: FocusDirection): boolean;

  /**
   * The size layout gives this widget when nothing constrains it. A composite
   * that hides or reparents its parts — a dropdown lifting its open list out
   * of this container — overrides this so the space it takes in the flow does
   * not depend on which part is on screen.
   */
  protected intrinsicSize(): { width: number; height: number } {
    return { width: this.view.width, height: this.view.height };
  }

  /**
   * Whether the size layout computes is what makes the widget that size. A
   * composite that places its own parts (a checkbox with a label, a radio
   * group) answers `false`: sizing its container would scale those parts out
   * of shape, so it draws at its own size inside the layout box.
   */
  protected sizedByLayout(): boolean {
    return true;
  }

  /**
   * The rectangle the focus outline is drawn around, in the widget view's own
   * space.
   *
   * A widget layout sizes is outlined around both its layout box and
   * everything it draws, so a part reaching outside the box is inside the
   * outline. A widget that keeps its own size is outlined around what it
   * draws. A widget whose drawn extent moves with its value overrides this
   * with a box that holds every value, so the outline stays still.
   */
  protected focusOutlineBox(): UIFocusOutlineBox {
    const bounds = this.view.getLocalBounds();
    if (!this.sizedByLayout()) {
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }
    // The layout box is in the parent's px; this box is in the widget's local
    // space.
    const scaleX = this.view.scale.x || 1;
    const scaleY = this.view.scale.y || 1;
    const width = this.yogaNode.getComputedWidth() / scaleX;
    const height = this.yogaNode.getComputedHeight() / scaleY;
    const left = Math.min(0, bounds.x);
    const top = Math.min(0, bounds.y);
    return {
      x: left,
      y: top,
      width: Math.max(width, bounds.x + bounds.width) - left,
      height: Math.max(height, bounds.y + bounds.height) - top,
    };
  }

  applyLayout(): void {
    if (this.sizedByLayout()) {
      this.view.width = this.yogaNode.getComputedWidth();
      this.view.height = this.yogaNode.getComputedHeight();
    }
    this._focusOutline.refresh();
  }

  /** Bridge a @pixi/ui Signal to a callback prop. Only reconnects if ref changed. */
  protected bridgeSignal<F extends (...args: unknown[]) => void>(
    signal: { connect: (cb: F) => void; disconnect: (cb: F) => void },
    key: string,
    kind: string,
    newProps: Record<string, unknown>,
  ): void {
    if (!(key in newProps)) return;
    const oldCb = this.prevProps[key] as F | undefined;
    const newCb = newProps[key] as F | undefined;
    if (newCb === oldCb) return;
    if (oldCb) {
      const callbacks = this.bridgedCallbacks.get(key);
      const oldWrapped = callbacks?.get(oldCb as (...args: never[]) => void) as
        | F
        | undefined;
      signal.disconnect(oldWrapped ?? oldCb);
      callbacks?.delete(oldCb as (...args: never[]) => void);
      if (callbacks?.size === 0) this.bridgedCallbacks.delete(key);
    }
    if (newCb) {
      const wrapped = ((...args: Parameters<F>) => {
        runUICallback(this.view, kind, () => newCb(...args));
      }) as F;
      let callbacks = this.bridgedCallbacks.get(key);
      if (!callbacks) {
        callbacks = new Map();
        this.bridgedCallbacks.set(key, callbacks);
      }
      callbacks.set(
        newCb as (...args: never[]) => void,
        wrapped as (...args: never[]) => void,
      );
      signal.connect(wrapped);
    }
  }

  protected disconnectBridgedSignal<F extends (...args: unknown[]) => void>(
    signal: { disconnect: (cb: F) => void },
    key: string,
  ): void {
    const callback = this.prevProps[key] as F | undefined;
    if (!callback) return;
    const callbacks = this.bridgedCallbacks.get(key);
    const wrapped = callbacks?.get(callback as (...args: never[]) => void) as
      | F
      | undefined;
    signal.disconnect(wrapped ?? callback);
    callbacks?.delete(callback as (...args: never[]) => void);
    if (callbacks?.size === 0) this.bridgedCallbacks.delete(key);
  }

  /**
   * Re-measure on the next layout pass. Yoga caches a measure function's
   * result, so a prop that changes the widget's intrinsic size (its text, its
   * item list) leaves the old size in the tree until the node is dirtied.
   */
  protected invalidateSize(): void {
    this.yogaNode.markDirty();
  }

  /** Apply layout props, visible, and store prevProps. Call at end of subclass update(). */
  protected updateBase(props: Record<string, unknown>): void {
    if (this.disabled) this._dropPress();
    applyLayoutProps(this.yogaNode, props as LayoutProps);
    if ("visible" in props)
      this.visible = (props.visible as boolean | undefined) ?? true;
    this.pointerEvents?.set(props as PointerEventProps);
    this._focus.set(props as FocusProps);
    this._focusOutline.set(props as FocusProps);
    Object.assign(this.prevProps, props);
  }

  abstract update(props: Record<string, unknown>): void;

  /** @internal */
  _inspectState(): { focused: boolean; focusable: boolean; disabled: boolean } {
    return {
      focused: this._focused,
      focusable: this.focusable,
      disabled: this.disabled,
    };
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._focus.destroy();
    this._focusOutline.destroy();
    this.disconnectAll();
    this.bridgedCallbacks.clear();
    this.yogaNode.free();
    this.view.destroy();
  }

  private _paintFocus(focused: boolean): void {
    this._focused = focused;
    this._focusOutline.setFocused(focused);
  }

  /**
   * The pressed face is asked for on every call, because the widget repaints
   * itself under this wrapper. The resting face is asked for only where this
   * wrapper is the one showing a press, so a pointer release the widget has
   * already painted is not painted twice.
   */
  private _paintPress(): void {
    if (this._destroyed) return;
    if (this.pressed) {
      this._paintedPressed = true;
      this.setPressed?.(true);
      return;
    }
    if (!this._paintedPressed) return;
    this._paintedPressed = false;
    this.setPressed?.(false);
  }

  /**
   * Forget every press a disabled widget was under, unpainted: it already
   * shows its disabled face, and must not spring back when enabled again.
   */
  private _dropPress(): void {
    this._pointerPressed = false;
    this._focusPressed = false;
    this._paintedPressed = false;
  }

  /** Override in subclass to disconnect all signals on destroy. */
  protected abstract disconnectAll(): void;
}
