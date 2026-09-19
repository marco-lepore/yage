import { Container } from "pixi.js";
import { devWarn } from "@yagejs/core";
import type { DisplayContainer, TextStyle } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { Display, Edge } from "yoga-layout";
import type {
  BackgroundOptions,
  LayoutValue,
  UIContainerElement,
  UIElement,
  UIButtonProps,
  UITextProps,
} from "./types.js";
import { resolvePadding } from "./types.js";
import {
  createYogaNode,
  applyLayoutProps,
  warnChildOverflow,
} from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";
import { UIText } from "./UIText.js";
import {
  addChild,
  insertChildBefore,
  removeChild,
} from "./internal/child-list.js";
import {
  attachChildToTree,
  attachChildrenToTree,
  detachChildFromTree,
} from "./internal/tree-context.js";
import type { UITreeContext } from "./internal/tree-context.js";
import { applyFlexContainerProps } from "./internal/flex-container.js";
import type { FlexContainerDefaults } from "./internal/flex-container.js";
import { HOVER_FACTOR, PRESS_FACTOR, deriveStateBg } from "./internal/color.js";
import { FocusOutline, layoutBox } from "./internal/focus-outline.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "./focus/pointer-request.js";
import { runUICallback } from "./error-boundary.js";

import { type ColorBackground, isTextureBackground } from "./types.js";

/** Background a button falls back to when the caller supplies none. */
const DEFAULT_BG: ColorBackground = { color: 0x444444, alpha: 1, radius: 4 };

/**
 * What a button lays its children out as. The constructor passes all three, so
 * these are both the starting state and what a dropped prop falls back to.
 */
const BUTTON_DEFAULTS: FlexContainerDefaults = {
  direction: "column",
  alignItems: "center",
  justifyContent: "center",
};

/** Default padding so auto-sized buttons have breathing room around their content. */
const DEFAULT_PAD_X = 12;
const DEFAULT_PAD_Y = 6;

/** Merge background options: use as-is for texture backgrounds, spread defaults for color. */
function mergeBg(
  def: ColorBackground,
  override?: BackgroundOptions,
): BackgroundOptions {
  if (!override) return def;
  if (isTextureBackground(override)) return override;
  return { ...def, ...override };
}

/**
 * A dimension counts as "explicit" if the caller pinned it to a concrete
 * value (px, %, vh / vw). `undefined` and `"auto"` both mean "shrink-to-
 * content", which is what default padding is for.
 */
function isExplicitSize(v: LayoutValue | undefined): boolean {
  return v !== undefined && v !== "auto";
}

/**
 * Interactive button for UI panels. Acts as a Yoga flex container — any
 * UIElement (UIText, UIImage, nested panels) can be added as a child via
 * `addElement`. When constructed with a string `children`, an internal
 * `UIText` is auto-added so the builder API (`panel.button("Label", ...)`)
 * and React JSX strings (`<Button>Label</Button>`) keep working with no
 * extra setup. Pass `width` / `height` explicitly to fix the size, or omit
 * them to let Yoga shrink-to-fit the content.
 */
export class UIButton implements UIContainerElement {
  readonly container: DisplayContainer;
  readonly yogaNode: YogaNode;

  get displayObject(): DisplayContainer {
    return this.container;
  }

  private bgRenderer: BackgroundRenderer;
  private _children: UIElement[] = [];
  private _label: UIText | undefined;
  private _labelStyle: Partial<TextStyle> | undefined;
  private _labelBitmap: boolean | undefined;
  private _truncate: "clip" | "ellipsis" | undefined;
  private _truncateWith: string | undefined;
  private _disabled = false;
  private _isHovered = false;
  // One flag per device holding the button down. They are separate states
  // with one look: the button paints pressed while either is set, and each
  // device clears only its own, so a mouse moving off the button never ends
  // a confirm press the player is still holding, and a confirm press never
  // ends the click the mouse is in the middle of making.
  private _pointerPressed = false;
  private _focusPressed = false;
  private _isFocused = false;
  private _pressStartedHere = false;
  private _computedWidth = 0;
  private _computedHeight = 0;
  private _hasExplicitWidth = false;
  private _hasExplicitHeight = false;
  private _defaultPaddingApplied = false;
  private _destroyed = false;
  private _treeContext: UITreeContext | undefined;
  private _debugLabel: string | undefined;
  private _hasExplicitPadding = false;
  private bgOpts: BackgroundOptions;
  private hoverBgOpts: BackgroundOptions;
  private pressBgOpts: BackgroundOptions;
  // The fill a focused button paints, only where the caller named one.
  private focusBgOpts: BackgroundOptions | undefined;
  // What the caller asked for, kept so a later `background` change re-derives
  // the states it did not override.
  private hoverBgOverride: BackgroundOptions | undefined;
  private pressBgOverride: BackgroundOptions | undefined;
  private focusBgOverride: BackgroundOptions | undefined;
  private onClick: (() => void) | undefined;
  private readonly pointerEvents: PointerEvents;
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;

  constructor(p: UIButtonProps) {
    this.yogaNode = createYogaNode();

    this._hasExplicitWidth = isExplicitSize(p.width);
    this._hasExplicitHeight = isExplicitSize(p.height);

    this._truncate = p.truncate;
    this._truncateWith = p.truncateWith;
    this.onClick = p.onClick;
    this.bgOpts = mergeBg(DEFAULT_BG, p.background);
    this.hoverBgOverride = p.hoverBackground;
    this.pressBgOverride = p.pressBackground;
    this.focusBgOverride = p.focusBackground;
    this.hoverBgOpts = this._resolveStateBg(this.hoverBgOverride, HOVER_FACTOR);
    this.pressBgOpts = this._resolveStateBg(this.pressBgOverride, PRESS_FACTOR);
    this.focusBgOpts = this._resolveFocusBg();

    this.container = new Container();
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    applyConsumeInput(this.container, p.consumeInput);

    this.bgRenderer = new BackgroundRenderer();
    this.bgRenderer.set(this.bgOpts, this.container, 0);

    applyLayoutProps(this.yogaNode, p);
    this._applyProps({
      direction: "column",
      alignItems: "center",
      justifyContent: "center",
      ...p,
    });

    // Auto-wrap a string child in a UIText so the builder API and React
    // JSX-string children both produce a centered label without callers
    // having to construct a UIText themselves.
    this._labelStyle = p.textStyle;
    this._labelBitmap = p.bitmap;
    if (typeof p.children === "string" && p.children.length > 0) {
      this._label = new UIText(this._labelProps(p.children));
      this.addElement(this._label);
    }

    if (p.disabled) this.setDisabled(true);
    if (p.visible === false) this.visible = false;

    // Every listener sets its own flags and repaints from all of them, so a
    // pointer leaving a row that holds focus repaints it as focused rather
    // than as resting, and whatever focus signal the game asked for — a
    // `focusBackground` fill, an outline from `focusStyle`, its own painting
    // from `onFocusChange` — stays on. Each listener touches the pointer's
    // own press flag and leaves a confirm press held on the button alone.
    //
    // Hovered and focused are separate states: the pointer passing over the
    // button tints it, and pressing it is what asks a focus scope to bring
    // the keyboard here.
    this.container.on("pointerover", () => {
      if (this._disabled) return;
      this._isHovered = true;
      requestHoverFocus(this);
      this.applyCurrentBg();
    });
    this.container.on("pointerout", () => {
      if (this._disabled) return;
      this._isHovered = false;
      this._pointerPressed = false;
      this.applyCurrentBg();
    });
    this.container.on("pointerdown", () => {
      if (this._disabled) return;
      this._pressStartedHere = true;
      this._pointerPressed = true;
      requestPressFocus(this);
      this.applyCurrentBg();
    });
    this.container.on("pointerup", () => {
      if (this._disabled) return;
      // Whether a release counts as a click is the pointer path's own
      // question: a press that began elsewhere must not fire this button.
      const shouldClick = this._pressStartedHere;
      this._pressStartedHere = false;
      this._pointerPressed = false;
      this.applyCurrentBg();
      if (shouldClick) this.activate();
    });
    this.container.on("pointerupoutside", () => {
      this._pressStartedHere = false;
      this._pointerPressed = false;
      this.applyCurrentBg();
    });

    // Hover callbacks fan out alongside the bg-swap above (separate listener
    // pair). Suppressed while disabled, mirroring the bg-swap guards.
    this.pointerEvents = new PointerEvents(
      this.container,
      p,
      () => this._disabled,
    );

    this._focusOutline = new FocusOutline({
      container: this.container,
      box: () => layoutBox(this.yogaNode, this._bgRadius()),
    });
    this._focusOutline.set(p);

    this._focus = new FocusState(this, p, {
      focusableByDefault: true,
      isDisabled: () => this._disabled,
      paint: (focused) => {
        this._isFocused = focused;
        this._focusOutline.setFocused(focused);
        this.applyCurrentBg();
      },
      setPressed: (pressed) => {
        this._focusPressed = pressed;
        this.applyCurrentBg();
      },
      activate: () => this.activate(),
    });
  }

  /** The corner radius the outline follows, from the resting background. */
  private _bgRadius(): number | undefined {
    return isTextureBackground(this.bgOpts) ? undefined : this.bgOpts.radius;
  }

  /**
   * Run the button's action: the click path and the focus scope's confirm
   * both come through here, so one disabled guard and one dispatch serve
   * both.
   *
   * Running the action is all this does. Each device ends its own press where
   * the player ends it — the pointer listener below on a release, the focus
   * scope when the confirm action goes up — so a confirm press cannot repaint
   * the button out from under a pointer that is still holding it down, nor
   * swallow the click that pointer is on its way to making. A call from game
   * code therefore shows no press of its own and disturbs none in progress.
   */
  activate(): void {
    if (this._disabled) return;
    if (this.onClick) {
      runUICallback(this.container, "UI onClick", this.onClick);
    }
  }

  /** Whether the button holds focus in the scope that owns it. */
  get focused(): boolean {
    return this._isFocused;
  }

  /** Whether the button takes part in focus navigation. */
  get focusable(): boolean {
    return this._focus.focusable;
  }

  get children(): readonly UIElement[] {
    return this._children;
  }

  addElement(child: UIElement): void {
    addChild(
      {
        children: this._children,
        container: this.container,
        yogaNode: this.yogaNode,
      },
      child,
      "UIButton.addElement",
    );
    attachChildToTree(child, this._treeContext);
  }

  removeElement(child: UIElement): void {
    if (
      removeChild(
        {
          children: this._children,
          container: this.container,
          yogaNode: this.yogaNode,
        },
        child,
      )
    ) {
      detachChildFromTree(child);
      if (child === this._label) this._label = undefined;
    }
  }

  insertElementBefore(child: UIElement, before: UIElement): void {
    insertChildBefore(
      {
        children: this._children,
        container: this.container,
        yogaNode: this.yogaNode,
      },
      child,
      before,
      "UIButton.insertElementBefore",
    );
    attachChildToTree(child, this._treeContext);
  }

  /**
   * Take the context of the UI tree this button belongs to: the name
   * development-mode warnings print, and the scene's focus stack. Stamped by
   * `UISurface` from the owning entity and passed down the tree.
   * @internal
   */
  _attachToTree(context: UITreeContext): void {
    this._treeContext = context;
    this._debugLabel = context.label;
    attachChildrenToTree(this._children, context);
  }

  /** @internal */
  _detachFromTree(): void {
    this._treeContext = undefined;
    this._debugLabel = undefined;
    for (const child of this._children) detachChildFromTree(child);
  }

  /** Apply Yoga-computed positions to children and resize background. */
  applyLayout(): void {
    for (const child of this._children) {
      // Scalar getters, not `getComputedLayout()`: the Yoga binding returns
      // that as a value object, allocating a fresh six-field object per child
      // per frame, and only the two edges below are read.
      child.displayObject.position.set(
        child.yogaNode.getComputedLeft(),
        child.yogaNode.getComputedTop(),
      );
      child.applyLayout?.();
    }
    warnChildOverflow(this.yogaNode, this._children, this._debugLabel);
    this._computedWidth = this.yogaNode.getComputedWidth();
    this._computedHeight = this.yogaNode.getComputedHeight();
    this.bgRenderer.resize(this._computedWidth, this._computedHeight);
    this._focusOutline.refresh();
  }

  /**
   * Applies the container props, reading key presence (`"padding" in p`)
   * rather than `!== undefined` for the same reason
   * {@link applyFlexContainerProps} does. Padding is the button's own: a
   * present key holding `undefined` drops the caller's value and puts the
   * default below back.
   */
  private _applyProps(p: Partial<UIButtonProps>): void {
    applyFlexContainerProps(this.yogaNode, p, BUTTON_DEFAULTS);

    if ("padding" in p) {
      this._hasExplicitPadding = p.padding !== undefined;
      const pad = this._hasExplicitPadding
        ? resolvePadding(p.padding)
        : { top: 0, right: 0, bottom: 0, left: 0 };
      this.yogaNode.setPadding(Edge.Top, pad.top);
      this.yogaNode.setPadding(Edge.Right, pad.right);
      this.yogaNode.setPadding(Edge.Bottom, pad.bottom);
      this.yogaNode.setPadding(Edge.Left, pad.left);
      // The caller's padding, or none at all, is in place; note that the
      // default is not, so dropping the prop puts it back.
      this._defaultPaddingApplied = false;
    }
    this._reconcileDefaultPadding();
  }

  /**
   * Default padding gives auto-sized buttons breathing room around their
   * content. Skip when the caller gave their own `padding`, and when both
   * dimensions are pinned explicitly — surprise padding would shrink the
   * content area inside an otherwise fixed-size button. Re-evaluated on
   * `update()` so dynamic dimension promotions / demotions keep the right
   * padding state.
   */
  private _reconcileDefaultPadding(): void {
    if (this._hasExplicitPadding) return;
    const want = !(this._hasExplicitWidth && this._hasExplicitHeight);
    if (want === this._defaultPaddingApplied) return;
    const padX = want ? DEFAULT_PAD_X : 0;
    const padY = want ? DEFAULT_PAD_Y : 0;
    this.yogaNode.setPadding(Edge.Left, padX);
    this.yogaNode.setPadding(Edge.Right, padX);
    this.yogaNode.setPadding(Edge.Top, padY);
    this.yogaNode.setPadding(Edge.Bottom, padY);
    this._defaultPaddingApplied = want;
  }

  /**
   * A state background is the caller's override when there is one, and
   * otherwise the resting background scaled to `factor`. A colour override
   * fills in over the derived colour, so an override giving only a colour
   * keeps the resting corner radius; an override of the other kind replaces
   * the derived background outright.
   */
  private _resolveStateBg(
    override: BackgroundOptions | undefined,
    factor: number,
  ): BackgroundOptions {
    const derived = deriveStateBg(this.bgOpts, factor);
    if (!override) return derived;
    if (isTextureBackground(override) || isTextureBackground(derived)) {
      return override;
    }
    return { ...derived, ...override };
  }

  /**
   * The fill a focused button paints: the caller's `focusBackground` and
   * nothing else, so a game that named no fill shows focus the way it asked
   * for elsewhere — an outline from `focusStyle`, or its own painting from
   * `onFocusChange`. A colour override fills in over the resting background,
   * so an override giving only a colour keeps the resting corner radius; an
   * override of the other kind replaces it outright.
   */
  private _resolveFocusBg(): BackgroundOptions | undefined {
    const override = this.focusBgOverride;
    if (override === undefined) return undefined;
    if (isTextureBackground(override) || isTextureBackground(this.bgOpts)) {
      return override;
    }
    return { ...this.bgOpts, ...override };
  }

  private applyBg(opts: BackgroundOptions): void {
    this.bgRenderer.set(opts, this.container, 0);
    if (this._computedWidth > 0 || this._computedHeight > 0) {
      this.bgRenderer.resize(this._computedWidth, this._computedHeight);
    }
  }

  /**
   * Whether any device is holding the button down, which is what paints it
   * pressed. One press is one look however many devices make it, so the
   * second to arrive changes nothing and the first to leave takes nothing
   * away.
   */
  private get _isPressed(): boolean {
    return this._pointerPressed || this._focusPressed;
  }

  /**
   * Paint the background for the button's state. A disabled button takes its
   * resting background whatever the hover flag holds, because the pointer
   * listeners return early while disabled and leave that flag set. Hovered
   * outranks focused here because the two are separate states and the pointer
   * is the more immediate of them: a focused row the pointer rests on shows
   * the hover tint, with whatever focus signal the game asked for on top of
   * it.
   */
  private applyCurrentBg(): void {
    const focusBg = this.focusBgOpts;
    if (this._disabled) this.applyBg(this.bgOpts);
    else if (this._isPressed) this.applyBg(this.pressBgOpts);
    else if (this._isHovered) this.applyBg(this.hoverBgOpts);
    else if (this._isFocused && focusBg) this.applyBg(focusBg);
    else this.applyBg(this.bgOpts);
  }

  /**
   * Build the internal label's props from the cached style / bitmap /
   * truncate mode. Omits absent keys so `exactOptionalPropertyTypes` stays
   * happy.
   */
  private _labelProps(children: string): UITextProps {
    const props: UITextProps = { children };
    if (this._labelStyle) props.style = this._labelStyle;
    if (this._labelBitmap !== undefined) props.bitmap = this._labelBitmap;
    if (this._truncate) props.truncate = this._truncate;
    if (this._truncateWith !== undefined) {
      props.truncateWith = this._truncateWith;
    }
    return props;
  }

  setText(s: string): void {
    if (this._label) {
      this._label.setText(s);
      return;
    }
    // Promote: caller constructed without a string child, but now wants a
    // label — create one and add it as the first child.
    this._label = new UIText(this._labelProps(s));
    this.addElement(this._label);
  }

  setDisabled(v: boolean): void {
    this._disabled = v;
    this.container.eventMode = v ? "none" : "static";
    this.container.cursor = v ? "default" : "pointer";
    this.container.alpha = v ? 0.5 : 1;
    // A disabled button refuses both devices, so both presses end here rather
    // than springing back when it is enabled again.
    if (v) {
      this._pressStartedHere = false;
      this._pointerPressed = false;
      this._focusPressed = false;
    }
    this.applyCurrentBg();
  }

  get disabled(): boolean {
    return this._disabled;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UIButtonProps>): void {
    // `bitmap` is construction-only for the label (Pixi v8 can't morph
    // Text↔BitmapText in place). Refresh the cached value while the label
    // hasn't been promoted yet, so a `setText` in this same update() builds
    // it with the right class; once a label exists, surface the dropped
    // change rather than silently rendering the wrong text type. `false` and
    // `undefined` both mean canvas, so coalesce before comparing.
    if ("bitmap" in p && (p.bitmap ?? false) !== (this._labelBitmap ?? false)) {
      if (this._label) {
        devWarn(
          "UIButton: `bitmap` is construction-only for the label and was " +
            "ignored on update() — remount the button (e.g. change its React " +
            "`key`) to switch the label between canvas and bitmap text.",
        );
      } else {
        this._labelBitmap = p.bitmap;
      }
    }
    // Refresh the cached label style (so a not-yet-promoted label is built
    // with it) and apply it in place when the label already exists. Mirrors
    // the bitmap refresh above so a `textStyle`-before-`children` two-step
    // update isn't silently dropped on the promote path. Removing the prop
    // resets the label to its default style.
    if ("textStyle" in p) {
      this._labelStyle = p.textStyle;
      this._label?.setStyle(p.textStyle ?? {});
    }
    if (p.children !== undefined && typeof p.children === "string") {
      this.setText(p.children);
    }
    // `"truncate" in p` (not `!== undefined`) so an explicit `{ truncate:
    // undefined }` from the reconciler clears the mode back to wrapping.
    if ("truncate" in p && p.truncate !== this._truncate) {
      this._truncate = p.truncate;
      this._label?.update({ truncate: p.truncate });
    }
    if ("truncateWith" in p && p.truncateWith !== this._truncateWith) {
      this._truncateWith = p.truncateWith;
      this._label?.update({ truncateWith: p.truncateWith });
    }
    if ("onClick" in p) this.onClick = p.onClick;
    this.pointerEvents.set(p);
    this._focus.set(p);
    this._focusOutline.set(p);

    // Ahead of `disabled` below: `setDisabled` repaints from `bgOpts`, so
    // `bgOpts` has to hold the value this same call supplies.
    if ("background" in p) {
      this.bgOpts = mergeBg(DEFAULT_BG, p.background);
    }
    if ("hoverBackground" in p) this.hoverBgOverride = p.hoverBackground;
    if ("pressBackground" in p) this.pressBgOverride = p.pressBackground;
    if ("focusBackground" in p) this.focusBgOverride = p.focusBackground;
    if (
      "background" in p ||
      "hoverBackground" in p ||
      "pressBackground" in p ||
      "focusBackground" in p
    ) {
      // A new resting background re-derives every state, not only the one
      // whose key is present, and the outline follows its corner radius.
      this.hoverBgOpts = this._resolveStateBg(
        this.hoverBgOverride,
        HOVER_FACTOR,
      );
      this.pressBgOpts = this._resolveStateBg(
        this.pressBgOverride,
        PRESS_FACTOR,
      );
      this.focusBgOpts = this._resolveFocusBg();
      this.applyCurrentBg();
      this._focusOutline.refresh();
    }

    if ("disabled" in p) this.setDisabled(p.disabled ?? false);
    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);

    if ("width" in p) this._hasExplicitWidth = isExplicitSize(p.width);
    if ("height" in p) this._hasExplicitHeight = isExplicitSize(p.height);

    applyLayoutProps(this.yogaNode, p);
    this._applyProps(p);

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /**
   * What the Inspector reports for this button, so a test reads its
   * interaction state instead of a screenshot.
   * @internal
   */
  _inspectState(): {
    focused: boolean;
    focusable: boolean;
    hovered: boolean;
    pressed: boolean;
    disabled: boolean;
  } {
    return {
      focused: this._isFocused,
      focusable: this._focus.focusable,
      hovered: this._isHovered,
      pressed: this._isPressed,
      disabled: this._disabled,
    };
  }

  /** Idempotent — a second call is a no-op (the React reconciler and a direct caller can both destroy the same instance). */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._focus.destroy();
    this._focusOutline.destroy();
    this._detachFromTree();
    clearConsumeInput(this.container);
    for (const child of this._children) {
      child.destroy();
    }
    this._children.length = 0;
    this._label = undefined;
    this.yogaNode.free();
    this.bgRenderer.destroy();
    this.container.destroy();
  }
}
