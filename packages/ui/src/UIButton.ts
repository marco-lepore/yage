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
  setChildDebugLabel,
  setChildrenDebugLabel,
} from "./internal/debug-label.js";
import { applyFlexContainerProps } from "./internal/flex-container.js";
import type { FlexContainerDefaults } from "./internal/flex-container.js";
import { runUICallback } from "./error-boundary.js";

import { type ColorBackground, isTextureBackground } from "./types.js";

/** Background a button falls back to when the caller supplies none. */
const DEFAULT_BG: ColorBackground = { color: 0x444444, alpha: 1, radius: 4 };

/**
 * Brightness the hover and press states are derived at from the resting
 * background. The default grey `0x444444` lands exactly on `0x555555` hovered
 * and `0x333333` pressed.
 */
const HOVER_FACTOR = 1.25;
const PRESS_FACTOR = 0.75;

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

/** Scale each 8-bit channel, clamped, so a colour brightens or darkens. */
function scaleChannels(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/**
 * Build a hover or press background from the resting one so a textured or
 * recoloured button keeps its look through both states. A colour background
 * has its colour scaled; a texture background keeps its texture and has its
 * tint scaled, which leaves the hover state a no-op at the default white tint
 * and darkens the press state. Channels clamp at 255, so a colour already
 * above roughly 0xCC brightens less than the factor asks for.
 */
function deriveStateBg(
  base: BackgroundOptions,
  factor: number,
): BackgroundOptions {
  if (isTextureBackground(base)) {
    return { ...base, tint: scaleChannels(base.tint ?? 0xffffff, factor) };
  }
  return { ...base, color: scaleChannels(base.color ?? 0x000000, factor) };
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
  private _isPressed = false;
  private _pressStartedHere = false;
  private _computedWidth = 0;
  private _computedHeight = 0;
  private _hasExplicitWidth = false;
  private _hasExplicitHeight = false;
  private _defaultPaddingApplied = false;
  private _destroyed = false;
  private _debugLabel: string | undefined;
  private _hasExplicitPadding = false;
  private bgOpts: BackgroundOptions;
  private hoverBgOpts: BackgroundOptions;
  private pressBgOpts: BackgroundOptions;
  // What the caller asked for, kept so a later `background` change re-derives
  // the states it did not override.
  private hoverBgOverride: BackgroundOptions | undefined;
  private pressBgOverride: BackgroundOptions | undefined;
  private onClick: (() => void) | undefined;
  private readonly pointerEvents: PointerEvents;

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
    this.hoverBgOpts = this._resolveStateBg(this.hoverBgOverride, HOVER_FACTOR);
    this.pressBgOpts = this._resolveStateBg(this.pressBgOverride, PRESS_FACTOR);

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

    this.container.on("pointerover", () => {
      if (this._disabled) return;
      this._isHovered = true;
      this.applyBg(this.hoverBgOpts);
    });
    this.container.on("pointerout", () => {
      if (this._disabled) return;
      this._isHovered = false;
      this._isPressed = false;
      this.applyBg(this.bgOpts);
    });
    this.container.on("pointerdown", () => {
      if (this._disabled) return;
      this._pressStartedHere = true;
      this._isPressed = true;
      this.applyBg(this.pressBgOpts);
    });
    this.container.on("pointerup", () => {
      if (this._disabled) return;
      const shouldClick = this._pressStartedHere;
      this._pressStartedHere = false;
      this._isPressed = false;
      this.applyBg(this.hoverBgOpts);
      if (shouldClick && this.onClick) {
        runUICallback(this.container, "UI onClick", this.onClick);
      }
    });
    this.container.on("pointerupoutside", () => {
      this._pressStartedHere = false;
      this._isPressed = false;
      this.applyCurrentBg();
    });

    // Hover callbacks fan out alongside the bg-swap above (separate listener
    // pair). Suppressed while disabled, mirroring the bg-swap guards.
    this.pointerEvents = new PointerEvents(
      this.container,
      p,
      () => this._disabled,
    );
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
    setChildDebugLabel(child, this._debugLabel);
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
      ) &&
      child === this._label
    ) {
      this._label = undefined;
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
    setChildDebugLabel(child, this._debugLabel);
  }

  /**
   * Name the UI tree this button belongs to for development-mode warnings.
   * Set by `UISurface` from the owning entity and passed down the tree.
   * @internal
   */
  _setDebugLabel(label: string): void {
    this._debugLabel = label;
    setChildrenDebugLabel(this._children, label);
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

  private applyBg(opts: BackgroundOptions): void {
    this.bgRenderer.set(opts, this.container, 0);
    if (this._computedWidth > 0 || this._computedHeight > 0) {
      this.bgRenderer.resize(this._computedWidth, this._computedHeight);
    }
  }

  /**
   * Paint the background for the button's state. A disabled button takes its
   * resting background whatever the hover flag holds, because the pointer
   * listeners return early while disabled and leave that flag set.
   */
  private applyCurrentBg(): void {
    if (this._disabled) this.applyBg(this.bgOpts);
    else if (this._isPressed) this.applyBg(this.pressBgOpts);
    else if (this._isHovered) this.applyBg(this.hoverBgOpts);
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
    if (v) {
      this._pressStartedHere = false;
      this._isPressed = false;
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

    // Ahead of `disabled` below: `setDisabled` repaints from `bgOpts`, so
    // `bgOpts` has to hold the value this same call supplies.
    if ("background" in p) {
      this.bgOpts = mergeBg(DEFAULT_BG, p.background);
    }
    if ("hoverBackground" in p) this.hoverBgOverride = p.hoverBackground;
    if ("pressBackground" in p) this.pressBgOverride = p.pressBackground;
    if ("background" in p || "hoverBackground" in p || "pressBackground" in p) {
      // A new resting background re-derives both states, not only the one
      // whose key is present.
      this.hoverBgOpts = this._resolveStateBg(
        this.hoverBgOverride,
        HOVER_FACTOR,
      );
      this.pressBgOpts = this._resolveStateBg(
        this.pressBgOverride,
        PRESS_FACTOR,
      );
      this.applyCurrentBg();
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

  /** Idempotent — a second call is a no-op (the React reconciler and a direct caller can both destroy the same instance). */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
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
