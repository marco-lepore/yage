import { Container } from "pixi.js";
import { devWarn } from "@yagejs/core";
import type { TextStyle } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { Align, Display, Edge, Justify } from "yoga-layout";
import type {
  BackgroundOptions,
  LayoutValue,
  UIContainerElement,
  UIElement,
  UIButtonProps,
  UITextProps,
} from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";
import { UIText } from "./UIText.js";

import { type ColorBackground, isTextureBackground } from "./types.js";

/** Default background colors for button states. */
const DEFAULT_BG: ColorBackground = { color: 0x444444, alpha: 1, radius: 4 };
const DEFAULT_HOVER_BG: ColorBackground = { color: 0x555555, alpha: 1, radius: 4 };
const DEFAULT_PRESS_BG: ColorBackground = { color: 0x333333, alpha: 1, radius: 4 };

/** Default padding so auto-sized buttons have breathing room around their content. */
const DEFAULT_PAD_X = 12;
const DEFAULT_PAD_Y = 6;

/** Merge background options: use as-is for texture backgrounds, spread defaults for color. */
function mergeBg(def: ColorBackground, override?: BackgroundOptions): BackgroundOptions {
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
  readonly container: Container;
  readonly yogaNode: YogaNode;

  get displayObject(): Container {
    return this.container;
  }

  private bgRenderer: BackgroundRenderer;
  private _children: UIElement[] = [];
  private _label: UIText | undefined;
  private _labelStyle: Partial<TextStyle> | undefined;
  private _labelBitmap: boolean | undefined;
  private _disabled = false;
  private _isHovered = false;
  private _isPressed = false;
  private _computedWidth = 0;
  private _computedHeight = 0;
  private _hasExplicitWidth = false;
  private _hasExplicitHeight = false;
  private _defaultPaddingApplied = false;
  private bgOpts: BackgroundOptions;
  private hoverBgOpts: BackgroundOptions;
  private pressBgOpts: BackgroundOptions;
  private onClick: (() => void) | undefined;
  private readonly pointerEvents: PointerEvents;

  constructor(p: UIButtonProps) {
    this.yogaNode = createYogaNode();
    this.yogaNode.setJustifyContent(Justify.Center);
    this.yogaNode.setAlignItems(Align.Center);

    this._hasExplicitWidth = isExplicitSize(p.width);
    this._hasExplicitHeight = isExplicitSize(p.height);
    this._reconcileDefaultPadding();

    this.onClick = p.onClick;
    this.bgOpts = mergeBg(DEFAULT_BG, p.background);
    this.hoverBgOpts = mergeBg(DEFAULT_HOVER_BG, p.hoverBackground);
    this.pressBgOpts = mergeBg(DEFAULT_PRESS_BG, p.pressBackground);

    this.container = new Container();
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    applyConsumeInput(this.container, p.consumeInput);

    this.bgRenderer = new BackgroundRenderer();
    this.bgRenderer.set(this.bgOpts, this.container, 0);

    applyLayoutProps(this.yogaNode, p);

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
      this._isPressed = true;
      this.applyBg(this.pressBgOpts);
    });
    this.container.on("pointerup", () => {
      if (this._disabled) return;
      this._isPressed = false;
      this.applyBg(this.hoverBgOpts);
      this.onClick?.();
    });

    // Hover callbacks fan out alongside the bg-swap above (separate listener
    // pair). Suppressed while disabled, mirroring the bg-swap guards.
    this.pointerEvents = new PointerEvents(this.container, p, () => this._disabled);
  }

  get children(): readonly UIElement[] {
    return this._children;
  }

  addElement(child: UIElement): void {
    this._children.push(child);
    this.container.addChild(child.displayObject);
    this.yogaNode.insertChild(child.yogaNode, this.yogaNode.getChildCount());
  }

  removeElement(child: UIElement): void {
    const idx = this._children.indexOf(child);
    if (idx === -1) return;
    this._children.splice(idx, 1);
    this.container.removeChild(child.displayObject);
    this.yogaNode.removeChild(child.yogaNode);
    if (child === this._label) this._label = undefined;
  }

  insertElementBefore(child: UIElement, before: UIElement): void {
    // React's mutation-mode reconciler may move a still-mounted child to a
    // new position via insertBefore. Detach it from its current slot first
    // so the splice below doesn't duplicate it in _children / Yoga.
    const existingIdx = this._children.indexOf(child);
    if (existingIdx !== -1) {
      this._children.splice(existingIdx, 1);
      this.container.removeChild(child.displayObject);
      this.yogaNode.removeChild(child.yogaNode);
    }

    const beforeIdx = this._children.indexOf(before);
    if (beforeIdx === -1) {
      this.addElement(child);
      return;
    }
    this._children.splice(beforeIdx, 0, child);
    const pixiIdx = this.container.children.indexOf(before.displayObject);
    if (pixiIdx !== -1) {
      this.container.addChildAt(child.displayObject, pixiIdx);
    } else {
      this.container.addChild(child.displayObject);
    }
    this.yogaNode.insertChild(child.yogaNode, beforeIdx);
  }

  /** Apply Yoga-computed positions to children and resize background. */
  applyLayout(): void {
    for (const child of this._children) {
      const layout = child.yogaNode.getComputedLayout();
      child.displayObject.position.set(layout.left, layout.top);
      child.applyLayout?.();
    }
    this._computedWidth = this.yogaNode.getComputedWidth();
    this._computedHeight = this.yogaNode.getComputedHeight();
    this.bgRenderer.resize(this._computedWidth, this._computedHeight);
  }

  /**
   * Default padding gives auto-sized buttons breathing room around their
   * content. Skip when the caller has pinned both dimensions explicitly —
   * surprise padding would shrink the content area inside an otherwise
   * fixed-size button. Re-evaluated on `update()` so dynamic dimension
   * promotions / demotions keep the right padding state.
   */
  private _reconcileDefaultPadding(): void {
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

  private applyBg(opts: BackgroundOptions): void {
    this.bgRenderer.set(opts, this.container, 0);
    if (this._computedWidth > 0 || this._computedHeight > 0) {
      this.bgRenderer.resize(this._computedWidth, this._computedHeight);
    }
  }

  private applyCurrentBg(): void {
    if (this._isPressed) this.applyBg(this.pressBgOpts);
    else if (this._isHovered) this.applyBg(this.hoverBgOpts);
    else this.applyBg(this.bgOpts);
  }

  /** Build the auto-wrapped label's props from the cached style / bitmap. */
  private _labelProps(children: string): UITextProps {
    return {
      children,
      ...(this._labelStyle ? { style: this._labelStyle } : {}),
      ...(this._labelBitmap !== undefined ? { bitmap: this._labelBitmap } : {}),
    };
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
      this.applyBg(this.bgOpts);
    } else {
      this.applyCurrentBg();
    }
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
    if (p.children !== undefined && typeof p.children === "string") {
      this.setText(p.children);
    }
    if (p.textStyle && this._label) {
      this._label.setStyle(p.textStyle);
    }
    if (p.onClick !== undefined) this.onClick = p.onClick;
    this.pointerEvents.set(p);
    if (p.disabled !== undefined) this.setDisabled(p.disabled);
    if (p.consumeInput !== undefined) applyConsumeInput(this.container, p.consumeInput);

    if (p.background) {
      this.bgOpts = mergeBg(DEFAULT_BG, p.background);
    }
    if (p.hoverBackground) {
      this.hoverBgOpts = mergeBg(DEFAULT_HOVER_BG, p.hoverBackground);
    }
    if (p.pressBackground) {
      this.pressBgOpts = mergeBg(DEFAULT_PRESS_BG, p.pressBackground);
    }
    if ((p.background || p.hoverBackground || p.pressBackground) && !this._disabled) {
      this.applyCurrentBg();
    }

    if (p.width !== undefined) this._hasExplicitWidth = isExplicitSize(p.width);
    if (p.height !== undefined) this._hasExplicitHeight = isExplicitSize(p.height);

    applyLayoutProps(this.yogaNode, p);
    this._reconcileDefaultPadding();

    if (p.visible !== undefined) {
      this.visible = p.visible;
    }
  }

  destroy(): void {
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
