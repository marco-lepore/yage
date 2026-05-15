import { Container, Graphics } from "pixi.js";
import type { FederatedPointerEvent, FederatedWheelEvent } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, FlexDirection, Overflow } from "yoga-layout";
import { attachMask, graphicsMask } from "@yagejs/renderer";
import type { MaskHandle } from "@yagejs/renderer";
import type {
  BackgroundOptions,
  Padding,
  ScrollViewProps,
  UIContainerElement,
  UIElement,
} from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { PanelNode } from "./UIPanel.js";
import { BackgroundRenderer } from "./background-renderer.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";

const SCROLLBAR_THICKNESS = 4;
const SCROLLBAR_MARGIN = 2;
const MIN_THUMB = 20;

/**
 * A clipped, scrollable viewport that owns a normal Yoga child subtree.
 *
 * Unlike the imperative `@pixi/ui` wrappers, this is a true
 * `UIContainerElement`: children are first-class Yoga nodes laid out by the
 * existing layout pass, so it works identically via the React reconciler
 * (`<ScrollView>`), the `PanelNode` builder (`.scrollView()`), or direct
 * `addElement`. Content overflowing the viewport on the scroll axis is
 * clipped by a mask and panned by a wheel/drag-driven offset that survives
 * re-renders (the node instance is stable; only children are diffed).
 */
export class ScrollViewNode implements UIContainerElement {
  readonly yogaNode: YogaNode;
  private readonly viewport: Container;
  private readonly content: PanelNode;
  private vertical: boolean;
  private scrollbarGfx: Graphics | undefined;
  private scrollbarEnabled: boolean;
  private maskHandle: MaskHandle | undefined;
  private bgRenderer: BackgroundRenderer | undefined;
  private bgOpts: BackgroundOptions | undefined;
  private onScroll: ((offset: number) => void) | undefined;

  private _offset = 0;
  private _maxScroll = 0;
  private _lastNotified = 0;

  // Cached computed metrics from the last layout pass so wheel/drag feels
  // immediate instead of waiting a frame for the next `applyLayout`.
  private _vw = 0;
  private _vh = 0;
  private _contentLeft = 0;
  private _contentTop = 0;

  private _dragging = false;
  private _dragStart = 0;
  private _dragStartOffset = 0;

  get displayObject(): Container {
    return this.viewport;
  }

  constructor(props: ScrollViewProps) {
    this.vertical = (props.direction ?? "vertical") === "vertical";
    this.scrollbarEnabled = props.scrollbar !== false;
    this.onScroll = props.onScroll;

    this.viewport = new Container();
    this.viewport.eventMode = "static";
    applyConsumeInput(this.viewport, props.consumeInput);

    this.yogaNode = createYogaNode();
    this.yogaNode.setOverflow(Overflow.Hidden);
    applyLayoutProps(this.yogaNode, props);
    // The scroll axis must be the viewport's MAIN axis: the content has
    // flexShrink 0, so it keeps its natural size on the main axis and
    // overflows (gets clipped + panned) while stretching on the cross axis.
    this.yogaNode.setFlexDirection(
      this.vertical ? FlexDirection.Column : FlexDirection.Row,
    );

    this.content = new PanelNode({
      direction: this.vertical ? "column" : "row",
      ...(props.gap !== undefined ? { gap: props.gap } : {}),
      ...(props.padding !== undefined ? { padding: props.padding } : {}),
    });
    // The content sizes to its children on the scroll axis and overflows the
    // viewport — never shrink it to fit the clipped box.
    this.content.yogaNode.setFlexShrink(0);
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

  // -- Public scroll API (also the non-federated fallback) -----------------

  /** Current scroll offset in pixels along the scroll axis. */
  get scrollOffset(): number {
    return this._offset;
  }

  /** Maximum scrollable offset (content overflow), computed each layout. */
  get maxScroll(): number {
    return this._maxScroll;
  }

  /** Scroll to an absolute offset (clamped). */
  scrollTo(offset: number): void {
    this._setOffset(offset);
  }

  /** Scroll by a relative delta (clamped). Positive = toward content end. */
  scrollBy(delta: number): void {
    this._setOffset(this._offset + delta);
  }

  // -- Layout --------------------------------------------------------------

  applyLayout(): void {
    this._vw = this.yogaNode.getComputedWidth();
    this._vh = this.yogaNode.getComputedHeight();
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

    this.maskHandle?.redraw();
    if (this.bgRenderer && this.bgOpts) {
      this.bgRenderer.resize(this._vw, this._vh);
    }
    this._drawScrollbar(viewportMain, contentMain);
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
    if (!this.scrollbarEnabled || this._maxScroll <= 0) {
      if (this.scrollbarGfx) this.scrollbarGfx.visible = false;
      return;
    }
    if (!this.scrollbarGfx) {
      this.scrollbarGfx = new Graphics();
      this.viewport.addChild(this.scrollbarGfx);
    }
    const g = this.scrollbarGfx;
    g.visible = true;

    const thumbLen = Math.max(
      MIN_THUMB,
      (viewportMain / contentMain) * viewportMain,
    );
    const travel = viewportMain - thumbLen;
    const t = this._maxScroll > 0 ? this._offset / this._maxScroll : 0;
    const pos = t * travel;

    g.clear();
    if (this.vertical) {
      g.roundRect(
        this._vw - SCROLLBAR_THICKNESS - SCROLLBAR_MARGIN,
        pos,
        SCROLLBAR_THICKNESS,
        thumbLen,
        SCROLLBAR_THICKNESS / 2,
      );
    } else {
      g.roundRect(
        pos,
        this._vh - SCROLLBAR_THICKNESS - SCROLLBAR_MARGIN,
        thumbLen,
        SCROLLBAR_THICKNESS,
        SCROLLBAR_THICKNESS / 2,
      );
    }
    g.fill({ color: 0xffffff, alpha: 0.4 });
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
    // Drag up/left → reveal later content → offset increases.
    this._setOffset(this._dragStartOffset + (this._dragStart - cur));
  };

  private readonly _onPointerUp = (): void => {
    this._dragging = false;
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
    this.onScroll?.(this._offset);
  }

  // -- Visibility / update / destroy ---------------------------------------

  get visible(): boolean {
    return this.viewport.visible;
  }

  set visible(v: boolean) {
    this.viewport.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(props: Partial<ScrollViewProps>): void {
    if (props.onScroll !== undefined) this.onScroll = props.onScroll;
    if (props.scrollbar !== undefined) this.scrollbarEnabled = props.scrollbar;
    if (props.consumeInput !== undefined) {
      applyConsumeInput(this.viewport, props.consumeInput);
    }

    if (props.background !== undefined) {
      this.bgOpts = props.background;
      if (props.background) {
        if (!this.bgRenderer) this.bgRenderer = new BackgroundRenderer();
        this.bgRenderer.set(props.background, this.viewport, 0);
      } else if (this.bgRenderer) {
        this.bgRenderer.destroy();
        this.bgRenderer = undefined;
      }
    }

    if (props.direction !== undefined) {
      const vertical = props.direction === "vertical";
      if (vertical !== this.vertical) {
        this.vertical = vertical;
        this.yogaNode.setFlexDirection(
          vertical ? FlexDirection.Column : FlexDirection.Row,
        );
        this.content.update({ direction: vertical ? "column" : "row" });
        // The scroll axis changed — the old offset is meaningless on it.
        this._offset = 0;
        this._lastNotified = 0;
      }
    }

    const contentUpdate: Partial<{ gap: number; padding: Padding }> = {};
    if (props.gap !== undefined) contentUpdate.gap = props.gap;
    if (props.padding !== undefined) contentUpdate.padding = props.padding;
    if (Object.keys(contentUpdate).length > 0) {
      this.content.update(contentUpdate);
    }

    applyLayoutProps(this.yogaNode, props);
    this.yogaNode.setOverflow(Overflow.Hidden);

    if (props.visible !== undefined) this.visible = props.visible;
  }

  destroy(): void {
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
