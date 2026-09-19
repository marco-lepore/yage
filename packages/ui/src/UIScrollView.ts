import { Container, Graphics, Rectangle } from "pixi.js";
import type { FederatedPointerEvent, FederatedWheelEvent } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, Edge, FlexDirection, Overflow } from "yoga-layout";
import { devWarn } from "@yagejs/core";
import { attachMask, graphicsMask } from "@yagejs/renderer";
import type { DisplayContainer, MaskHandle, TextStyle } from "@yagejs/renderer";
import type {
  BackgroundOptions,
  Padding,
  UIButtonProps,
  UIPanelProps,
  ScrollbarOptions,
  UIScrollIntoViewOptions,
  UIScrollViewProps,
  UIContainerElement,
  UIElement,
  UITextBuilderProps,
} from "./types.js";
import {
  createYogaNode,
  applyLayoutProps,
  exemptFromOverflowWarning,
} from "./yoga-helpers.js";
import { UIPanel } from "./UIPanel.js";
import { FocusOutline, layoutBox } from "./internal/focus-outline.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "./focus/pointer-request.js";
import { markScrollView } from "./focus/scroll-registry.js";
import type { UITreeContext } from "./internal/tree-context.js";
import type { UIButton } from "./UIButton.js";
import type { UIText } from "./UIText.js";
import { BackgroundRenderer } from "./background-renderer.js";
import { PointerEvents } from "./pointer-events.js";
import { runUICallback } from "./error-boundary.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";

interface ResolvedScrollbar {
  enabled: boolean;
  thickness: number;
  color: number;
  alpha: number;
  radius: number;
  minThumb: number;
  margin: number;
}

/** Top-left corner of an element, the point a scroll-into-view projects. */
const ORIGIN = { x: 0, y: 0 } as const;

/** Reused destination of that projection, so a call allocates nothing. */
const projected = { x: 0, y: 0 };

const SCROLLBAR_DEFAULTS = {
  thickness: 4,
  color: 0xffffff,
  alpha: 0.4,
  minThumb: 20,
  margin: 2,
} as const;

function resolveScrollbar(
  prop: boolean | ScrollbarOptions | undefined,
): ResolvedScrollbar {
  const enabled = prop !== false;
  const o: ScrollbarOptions = prop && typeof prop === "object" ? prop : {};
  const thickness = o.thickness ?? SCROLLBAR_DEFAULTS.thickness;
  return {
    enabled,
    thickness,
    color: o.color ?? SCROLLBAR_DEFAULTS.color,
    alpha: o.alpha ?? SCROLLBAR_DEFAULTS.alpha,
    radius: o.radius ?? thickness / 2,
    minThumb: o.minThumbLength ?? SCROLLBAR_DEFAULTS.minThumb,
    margin: o.margin ?? SCROLLBAR_DEFAULTS.margin,
  };
}

/**
 * A clipped, scrollable viewport that owns a normal Yoga child subtree.
 *
 * Unlike the imperative `@pixi/ui` wrappers, this is a true
 * `UIContainerElement`: children are first-class Yoga nodes laid out by the
 * existing layout pass, so it works identically via the React reconciler
 * (`<ScrollView>`), the `UIPanel` builder (`.scrollView()`), or direct
 * `addElement`. Content overflowing the viewport on the scroll axis is
 * clipped by a mask and panned by a wheel/drag-driven offset that survives
 * re-renders (the node instance is stable; only children are diffed).
 */
export class UIScrollView implements UIContainerElement {
  readonly yogaNode: YogaNode;
  private readonly viewport: Container;
  private readonly content: UIPanel;
  private readonly pointerEvents: PointerEvents;
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;
  private vertical: boolean;
  private scrollbarGfx: Graphics | undefined;
  private _sb: ResolvedScrollbar;
  private maskHandle: MaskHandle | undefined;
  private bgRenderer: BackgroundRenderer | undefined;
  private bgOpts: BackgroundOptions | undefined;
  private onScroll: ((offset: number) => void) | undefined;
  // Explicit hit area so wheel/drag work over gaps, the scrollbar gutter,
  // and empty space below the last card. A bare `eventMode:"static"`
  // Container is only hit-tested where a descendant actually renders, so
  // input would otherwise be dead anywhere a child isn't painted (unless a
  // full-bleed `background` happens to cover it). Reused, synced in layout.
  private readonly _hitArea = new Rectangle(0, 0, 0, 0);

  private _offset = 0;
  private _maxScroll = 0;
  private _lastNotified = 0;

  // Cached computed metrics from the last layout pass so wheel/drag feels
  // immediate instead of waiting a frame for the next `applyLayout`.
  private _vw = 0;
  private _vh = 0;
  private _contentLeft = 0;
  private _contentTop = 0;

  // Size the clip mask was last drawn at. `NaN` never equals a computed size,
  // so the first draw gets through.
  private _maskWidth = Number.NaN;
  private _maskHeight = Number.NaN;

  // State the scrollbar thumb was last drawn from. `NaN` never equals a
  // computed number, so writing it forces the next draw — which is how the
  // two inputs that are not numbers on this list get through: a replaced
  // scrollbar style and a direction flip.
  private _sbViewportMain = Number.NaN;
  private _sbViewportCross = Number.NaN;
  private _sbOffset = Number.NaN;
  private _sbMaxScroll = Number.NaN;

  // One warning per view for a scroll-into-view asked for before the first
  // layout pass: the focus follow calls it every tick, and the cause is the
  // same one every time.
  private _layoutWarned = false;

  private _dragging = false;
  private _panning = false;
  private _dragStart = 0;
  private _dragStartOffset = 0;
  private _destroyed = false;

  get displayObject(): DisplayContainer {
    return this.viewport;
  }

  constructor(props: UIScrollViewProps) {
    this.vertical = (props.direction ?? "vertical") === "vertical";
    this._sb = resolveScrollbar(props.scrollbar);
    this.onScroll = props.onScroll;

    this.viewport = new Container();
    this.viewport.eventMode = "static";
    this.viewport.hitArea = this._hitArea;
    applyConsumeInput(this.viewport, props.consumeInput);
    // The hover fan-out sits on the clipped viewport, not on the content
    // panel: the viewport is the box a pointer enters and leaves, while the
    // content is taller than it and moves under the scroll offset.
    this.pointerEvents = new PointerEvents(this.viewport, props);

    // The view is a candidate as well as a container: out of focus navigation
    // until a game asks for it with `focusable`, which is what panning a list
    // with the stick needs. The candidate walk still descends into the rows,
    // and a row is deeper than the view, so a press on a row asks for focus
    // on the row. Asked for, the viewport is outlined like every other
    // focusable element.
    this._focusOutline = new FocusOutline({
      container: this.viewport,
      box: () => layoutBox(this.yogaNode),
    });
    this._focusOutline.set(props);
    this._focus = new FocusState(this, props, {
      focusableByDefault: false,
      paint: (focused) => this._focusOutline.setFocused(focused),
    });
    this.viewport.on("pointerover", () => {
      requestHoverFocus(this);
    });
    this.viewport.on("pointerdown", () => {
      requestPressFocus(this);
    });

    this.yogaNode = createYogaNode();
    this.yogaNode.setOverflow(Overflow.Hidden);
    // Let a flex parent size the viewport smaller than its (overflowing)
    // content — the Yoga equivalent of the CSS `min-height:0` scroll-
    // container fix. A flex item's automatic min size is its content size,
    // AND Yoga's default flexShrink is 0 (unlike web's 1), so without both
    // of these the viewport grows to its flexShrink:0 content and never
    // scrolls when nested (e.g. `flexGrow:1` in a fixed-height panel).
    // Set before applyLayoutProps so explicit props still win.
    this.yogaNode.setMinWidth(0);
    this.yogaNode.setMinHeight(0);
    this.yogaNode.setFlexShrink(1);
    applyLayoutProps(this.yogaNode, props);
    // The scroll axis must be the viewport's MAIN axis: the content has
    // flexShrink 0, so it keeps its natural size on the main axis and
    // overflows (gets clipped + panned) while stretching on the cross axis.
    this.yogaNode.setFlexDirection(
      this.vertical ? FlexDirection.Column : FlexDirection.Row,
    );
    this._applyGutter();

    this.content = new UIPanel({
      direction: this.vertical ? "column" : "row",
      ...(props.gap !== undefined ? { gap: props.gap } : {}),
      ...(props.padding !== undefined ? { padding: props.padding } : {}),
    });
    // The content sizes to its children on the scroll axis and overflows the
    // viewport — never shrink it to fit the clipped box.
    this.content.yogaNode.setFlexShrink(0);
    // Content overflowing the (clipped, scrollable) viewport is the whole
    // point — exempt it from the dev overflow warning so scroll views don't
    // spam it every frame.
    exemptFromOverflowWarning(this.content.yogaNode);
    this.yogaNode.insertChild(this.content.yogaNode, 0);

    if (props.background) {
      this.bgOpts = props.background;
      this.bgRenderer = new BackgroundRenderer();
      this.bgRenderer.set(props.background, this.viewport, 0);
    }

    this.viewport.addChild(this.content.container);

    this.maskHandle = attachMask(
      this.viewport,
      graphicsMask((g) => {
        g.clear();
        g.rect(
          0,
          0,
          this.yogaNode.getComputedWidth(),
          this.yogaNode.getComputedHeight(),
        );
        g.fill({ color: 0xffffff });
      }),
    );

    this._attachInput();
    markScrollView(this);
  }

  // -- UIContainerElement: delegate child management to the content panel ---

  get children(): readonly UIElement[] {
    return this.content.children;
  }

  addElement(child: UIElement): void {
    this.content.addElement(child);
  }

  removeElement(child: UIElement): void {
    this.content.removeElement(child);
  }

  insertElementBefore(child: UIElement, before: UIElement): void {
    this.content.insertElementBefore(child, before);
  }

  // -- Builders, forwarded to the content panel -----------------------------

  /** Add a text element. See {@link UIPanel.text} for `opts`. */
  text(
    content: string,
    style?: Partial<TextStyle>,
    opts?: UITextBuilderProps,
  ): UIText {
    return this.content.text(content, style, opts);
  }

  /** Add a button element. */
  button(label: string, opts: Omit<UIButtonProps, "children">): UIButton {
    return this.content.button(label, opts);
  }

  /** Add a nested child panel. */
  panel(opts?: UIPanelProps): UIPanel {
    return this.content.panel(opts);
  }

  /** Add a nested scrollable viewport. */
  scrollView(opts?: UIScrollViewProps): UIScrollView {
    return this.content.scrollView(opts);
  }

  /**
   * Take the context of the UI tree this viewport belongs to. The content
   * panel holds the children, so it holds the context.
   * @internal
   */
  _attachToTree(context: UITreeContext): void {
    this.content._attachToTree(context);
  }

  /** @internal */
  _detachFromTree(): void {
    this.content._detachFromTree();
  }

  // -- Public scroll API (also the non-federated fallback) -----------------

  /** Current scroll offset in pixels along the scroll axis. */
  get scrollOffset(): number {
    return this._offset;
  }

  /** Maximum scrollable offset (content overflow), computed each layout. */
  get maxScroll(): number {
    return this._maxScroll;
  }

  /**
   * Width of the clipped viewport in px, as the last layout pass computed it
   * — the box the mask clips to, so a vertical view's scrollbar gutter is
   * part of it. `0` before the first layout pass.
   */
  get viewportWidth(): number {
    return this._vw;
  }

  /**
   * Height of the clipped viewport in px, as the last layout pass computed it
   * — the box the mask clips to, so a horizontal view's scrollbar gutter is
   * part of it. `0` before the first layout pass.
   */
  get viewportHeight(): number {
    return this._vh;
  }

  /**
   * Px reserved on the scroll-cross edge for the scrollbar so content never
   * renders under the thumb. `0` when the scrollbar is hidden.
   */
  get scrollbarGutter(): number {
    return this._sb.enabled ? this._sb.thickness + this._sb.margin * 2 : 0;
  }

  /**
   * Reserve the gutter as padding on the viewport node's scroll-cross edge
   * (right for vertical, bottom for horizontal) and clear the other edge so
   * a direction flip cleans up. The thumb is drawn inside this gutter.
   */
  private _applyGutter(): void {
    const g = this.scrollbarGutter;
    this.yogaNode.setPadding(Edge.Right, this.vertical ? g : 0);
    this.yogaNode.setPadding(Edge.Bottom, this.vertical ? 0 : g);
  }

  /** Scroll to an absolute offset (clamped). */
  scrollTo(offset: number): void {
    this._setOffset(offset);
  }

  /** Scroll by a relative delta (clamped). Positive = toward content end. */
  scrollBy(delta: number): void {
    this._setOffset(this._offset + delta);
  }

  /**
   * Scroll the least distance that brings `element` inside the viewport on
   * this view's scroll axis. `align` decides where it lands and defaults to
   * `"nearest"`, which leaves an element already fully visible where it is,
   * so a list does not jitter and `onScroll` does not fire.
   *
   * `padding` is px kept between the element and the viewport edge it is
   * aligned against; it does not apply to `align: "center"`, where the
   * element sits in the middle of the viewport.
   *
   * One layout pass has to have run: before that the element has no laid-out
   * box, the call does nothing and a development warning names the view.
   *
   * @throws when `element` is not inside this view, or `padding` is not a
   * finite number of pixels at or above zero — both before the offset moves.
   */
  scrollIntoView(element: UIElement, opts?: UIScrollIntoViewOptions): void {
    const padding = opts?.padding ?? 0;
    if (!Number.isFinite(padding) || padding < 0) {
      throw new Error(
        "UIScrollView.scrollIntoView: padding must be a finite number of " +
          `pixels at or above 0, got ${padding}.`,
      );
    }
    if (!this._contains(element)) {
      throw new Error(
        "UIScrollView.scrollIntoView: the element is not inside this scroll " +
          "view.",
      );
    }

    // The element's top-left in the content panel's own space. That space
    // does not move with the offset — the offset is the content container's
    // position — so the same element answers the same number at every scroll
    // position, and no ancestor's box has to be summed.
    const p = this.content.container.toLocal(
      ORIGIN,
      element.displayObject,
      projected,
    );
    const extent = this.vertical
      ? element.yogaNode.getComputedHeight()
      : element.yogaNode.getComputedWidth();
    const start = this.vertical ? p.y : p.x;
    if (!Number.isFinite(extent) || !Number.isFinite(start)) {
      if (!this._layoutWarned) {
        this._layoutWarned = true;
        devWarn(
          "UIScrollView.scrollIntoView: the scroll view needs one layout " +
            "pass before an element can be scrolled into view.",
        );
      }
      return;
    }

    // The gutter is reserved on the cross axis, so the whole main-axis size
    // is scrollable viewport.
    const viewportMain = this.vertical ? this._vh : this._vw;
    const contentOrigin = this.vertical ? this._contentTop : this._contentLeft;
    const visibleStart = this._offset - contentOrigin;
    const visibleEnd = visibleStart + viewportMain;
    const toStart = start - visibleStart - padding;
    const toEnd = start + extent - visibleEnd + padding;

    let delta: number;
    switch (opts?.align ?? "nearest") {
      case "start":
        delta = toStart;
        break;
      case "end":
        delta = toEnd;
        break;
      case "center":
        delta = start + extent / 2 - (visibleStart + viewportMain / 2);
        break;
      default:
        if (toStart < 0) delta = toStart;
        else if (toEnd > 0) delta = toEnd;
        else return;
    }
    this._setOffset(this._offset + delta);
  }

  /**
   * Whether `element` hangs under the content panel. The display parent chain
   * is the only answer: `toLocal` projects any element that shares a stage,
   * so it cannot tell a foreign element from a descendant.
   */
  private _contains(element: UIElement): boolean {
    let node: DisplayContainer | null = element.displayObject.parent;
    while (node !== null) {
      if (node === this.content.container) return true;
      node = node.parent;
    }
    return false;
  }

  // -- Layout --------------------------------------------------------------

  applyLayout(): void {
    this._vw = this.yogaNode.getComputedWidth();
    this._vh = this.yogaNode.getComputedHeight();
    this._hitArea.width = this._vw;
    this._hitArea.height = this._vh;
    this._contentLeft = this.content.yogaNode.getComputedLeft();
    this._contentTop = this.content.yogaNode.getComputedTop();

    const viewportMain = this.vertical ? this._vh : this._vw;
    const contentMain = this.vertical
      ? this.content.yogaNode.getComputedHeight()
      : this.content.yogaNode.getComputedWidth();

    this._maxScroll = Math.max(0, contentMain - viewportMain);
    if (this._offset > this._maxScroll) this._offset = this._maxScroll;
    if (this._offset < 0) this._offset = 0;

    this._positionContent();
    // Recurse so the card subtrees get their Yoga-computed positions.
    this.content.applyLayout();

    if (
      this.maskHandle &&
      (this._vw !== this._maskWidth || this._vh !== this._maskHeight)
    ) {
      this._maskWidth = this._vw;
      this._maskHeight = this._vh;
      this.maskHandle.redraw();
    }
    if (this.bgRenderer && this.bgOpts) {
      this.bgRenderer.resize(this._vw, this._vh);
    }
    this._drawScrollbar(viewportMain, contentMain);
    this._focusOutline.refresh();
    this._notify();
  }

  private _positionContent(): void {
    if (this.vertical) {
      this.content.container.position.set(
        this._contentLeft,
        this._contentTop - this._offset,
      );
    } else {
      this.content.container.position.set(
        this._contentLeft - this._offset,
        this._contentTop,
      );
    }
  }

  private _drawScrollbar(viewportMain: number, contentMain: number): void {
    if (!this._sb.enabled || this._maxScroll <= 0) {
      // Hiding keeps the geometry, so a bar that comes back at the state it
      // was hidden in needs no redraw.
      if (this.scrollbarGfx) this.scrollbarGfx.visible = false;
      return;
    }
    if (!this.scrollbarGfx) {
      this.scrollbarGfx = new Graphics();
      this.viewport.addChild(this.scrollbarGfx);
    }
    const g = this.scrollbarGfx;
    g.visible = true;

    // The cross-axis viewport size is part of the gate, not only the main
    // axis: the thumb's fixed edge sits at `_vw - thickness - margin` for a
    // vertical bar and `_vh - thickness - margin` for a horizontal one, so a
    // cross-axis-only resize moves the thumb.
    const viewportCross = this.vertical ? this._vw : this._vh;
    if (
      viewportMain === this._sbViewportMain &&
      viewportCross === this._sbViewportCross &&
      this._offset === this._sbOffset &&
      this._maxScroll === this._sbMaxScroll
    ) {
      return;
    }
    this._sbViewportMain = viewportMain;
    this._sbViewportCross = viewportCross;
    this._sbOffset = this._offset;
    this._sbMaxScroll = this._maxScroll;

    const { thickness, margin, radius, color, alpha, minThumb } = this._sb;
    const thumbLen = Math.max(
      minThumb,
      (viewportMain / contentMain) * viewportMain,
    );
    const travel = viewportMain - thumbLen;
    const t = this._maxScroll > 0 ? this._offset / this._maxScroll : 0;
    const pos = t * travel;

    g.clear();
    if (this.vertical) {
      g.roundRect(
        this._vw - thickness - margin,
        pos,
        thickness,
        thumbLen,
        radius,
      );
    } else {
      g.roundRect(
        pos,
        this._vh - thickness - margin,
        thumbLen,
        thickness,
        radius,
      );
    }
    g.fill({ color, alpha });
  }

  // -- Input ---------------------------------------------------------------

  private _attachInput(): void {
    this.viewport.on("wheel", this._onWheel);
    this.viewport.on("pointerdown", this._onPointerDown);
    this.viewport.on("globalpointermove", this._onPointerMove);
    this.viewport.on("pointerup", this._onPointerUp);
    this.viewport.on("pointerupoutside", this._onPointerUp);
  }

  private _detachInput(): void {
    this.viewport.off("wheel", this._onWheel);
    this.viewport.off("pointerdown", this._onPointerDown);
    this.viewport.off("globalpointermove", this._onPointerMove);
    this.viewport.off("pointerup", this._onPointerUp);
    this.viewport.off("pointerupoutside", this._onPointerUp);
  }

  private readonly _onWheel = (e: FederatedWheelEvent): void => {
    if (this._maxScroll <= 0) return;
    // deltaMode: 0 = pixels, 1 = lines (~16px), 2 = pages (one viewport).
    const unit =
      e.deltaMode === 2
        ? this.vertical
          ? this._vh
          : this._vw
        : e.deltaMode === 1
          ? 16
          : 1;
    const delta = this.vertical ? e.deltaY : e.deltaX || e.deltaY;
    this._setOffset(this._offset + delta * unit);
  };

  private readonly _onPointerDown = (e: FederatedPointerEvent): void => {
    this._dragging = true;
    this._dragStart = this.vertical ? e.global.y : e.global.x;
    this._dragStartOffset = this._offset;
  };

  private readonly _onPointerMove = (e: FederatedPointerEvent): void => {
    if (!this._dragging) return;
    const cur = this.vertical ? e.global.y : e.global.x;
    if (!this._panning) {
      if (Math.abs(cur - this._dragStart) < 10) return;
      this._panning = true;
      this.viewport.interactiveChildren = false;
    }
    // Drag up/left → reveal later content → offset increases.
    this._setOffset(this._dragStartOffset + (this._dragStart - cur));
  };

  private readonly _onPointerUp = (): void => {
    this._dragging = false;
    if (this._panning) {
      this._panning = false;
      this.viewport.interactiveChildren = true;
    }
  };

  private _setOffset(next: number): void {
    const clamped = Math.max(0, Math.min(next, this._maxScroll));
    if (clamped === this._offset) return;
    this._offset = clamped;
    // Immediate visual feedback; `applyLayout` reconciles next frame.
    this._positionContent();
    this._notify();
  }

  private _notify(): void {
    if (this._offset === this._lastNotified) return;
    this._lastNotified = this._offset;
    if (this.onScroll) {
      runUICallback(this.viewport, "UI onScroll", () =>
        this.onScroll?.(this._offset),
      );
    }
  }

  // -- Visibility / update / destroy ---------------------------------------

  get visible(): boolean {
    return this.viewport.visible;
  }

  set visible(v: boolean) {
    this.viewport.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(props: Partial<UIScrollViewProps>): void {
    if ("onScroll" in props) this.onScroll = props.onScroll;
    this.pointerEvents.set(props);
    this._focus.set(props);
    this._focusOutline.set(props);
    if ("scrollbar" in props) {
      // A replaced style changes thickness, margin, radius, colour, alpha or
      // minimum thumb length without moving the viewport, the offset or the
      // scroll range, so the numeric gate alone would keep the old thumb.
      this._sb = resolveScrollbar(props.scrollbar);
      this._sbViewportMain = Number.NaN;
    }
    if ("consumeInput" in props) {
      applyConsumeInput(this.viewport, props.consumeInput);
    }

    if ("background" in props) {
      this.bgOpts = props.background;
      if (props.background) {
        if (!this.bgRenderer) this.bgRenderer = new BackgroundRenderer();
        this.bgRenderer.set(props.background, this.viewport, 0);
      } else if (this.bgRenderer) {
        this.bgRenderer.destroy();
        this.bgRenderer = undefined;
      }
    }

    if ("direction" in props) {
      const vertical = (props.direction ?? "vertical") === "vertical";
      if (vertical !== this.vertical) {
        this.vertical = vertical;
        this.yogaNode.setFlexDirection(
          vertical ? FlexDirection.Column : FlexDirection.Row,
        );
        this.content.update({ direction: vertical ? "column" : "row" });
        // Main and cross swap, so the cached pair no longer describes the
        // thumb even on a square viewport.
        this._sbViewportMain = Number.NaN;
        // The scroll axis changed — the old offset is meaningless on it.
        // Leave _lastNotified untouched so the next _notify() (in
        // applyLayout) emits the reset to onScroll consumers.
        this._offset = 0;
      }
    }

    const contentUpdate: {
      gap?: number | undefined;
      padding?: Padding | undefined;
    } = {};
    if ("gap" in props) contentUpdate.gap = props.gap;
    if ("padding" in props) contentUpdate.padding = props.padding;
    if (Object.keys(contentUpdate).length > 0) {
      // Cast: `contentUpdate` may carry an explicit `undefined` (a removed
      // gap/padding, forwarded as a reset) which `exactOptionalPropertyTypes`
      // doesn't allow through `Partial<UIPanelProps>`'s plain `gap?: number`.
      // UIPanel.update() reads presence, not the static type, so this is safe.
      this.content.update(contentUpdate as Partial<UIPanelProps>);
    }

    applyLayoutProps(this.yogaNode, props);
    this.yogaNode.setOverflow(Overflow.Hidden);
    // Re-reserve the gutter: covers a scrollbar style/visibility change, a
    // direction flip (edges swap), and any padding reset by applyLayoutProps.
    this._applyGutter();

    if ("visible" in props) this.visible = props.visible ?? true;
  }

  /**
   * What the Inspector reports for this scroll view: whether it takes part in
   * focus navigation, which is off unless the game asked for it, and whether
   * it holds focus right now. A test reads this instead of a screenshot.
   * @internal
   */
  _inspectState(): { focused: boolean; focusable: boolean } {
    return { focused: this._focus.focused, focusable: this._focus.focusable };
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._detachFromTree();
    this._focus.destroy();
    this._focusOutline.destroy();
    this._detachInput();
    clearConsumeInput(this.viewport);
    this.maskHandle?.remove();
    this.maskHandle = undefined;
    this.scrollbarGfx?.destroy();
    this.content.destroy();
    this.bgRenderer?.destroy();
    this.yogaNode.free();
    this.viewport.destroy();
  }
}
