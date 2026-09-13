import { Container, Rectangle } from "pixi.js";
import type { TextStyle } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { Gutter, Edge, Overflow, Display } from "yoga-layout";
import {
  Align,
  FlexDirection as YogaFlexDirection,
  Justify,
} from "yoga-layout";
import { attachMask, graphicsMask } from "@yagejs/renderer";
import type { DisplayContainer, MaskHandle } from "@yagejs/renderer";
import { UIText } from "./UIText.js";
import { UIButton } from "./UIButton.js";
import { UIScrollView } from "./UIScrollView.js";
import { resolvePadding } from "./types.js";
import type {
  BackgroundOptions,
  UIElement,
  UIContainerElement,
  UIButtonProps,
  UIPanelProps,
  UIScrollViewProps,
} from "./types.js";
import {
  createYogaNode,
  applyLayoutProps,
  warnChildOverflow,
} from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";
import {
  addChild,
  insertChildBefore,
  removeChild,
} from "./internal/child-list.js";
import {
  setChildDebugLabel,
  setChildrenDebugLabel,
} from "./internal/debug-label.js";
import {
  toAlignItems,
  toFlexDirection,
  toJustify,
} from "./internal/flex-enums.js";

// ---------------------------------------------------------------------------
// UIPanel — Yoga-powered flex container
// ---------------------------------------------------------------------------

/**
 * Flex container element — both the root of a `UISurface`'s mounted tree and
 * any nested child panel. Manages a Yoga container node, a PixiJS Container,
 * optional background, and an ordered list of UIElement children.
 */
export class UIPanel implements UIContainerElement {
  readonly container: DisplayContainer;
  readonly yogaNode: YogaNode;

  get displayObject(): DisplayContainer {
    return this.container;
  }

  private bgRenderer: BackgroundRenderer | undefined;
  private maskHandle: MaskHandle | undefined;
  // Size the overflow mask was last drawn at. `NaN` never equals a computed
  // size, so the first draw after the mask is created always gets through.
  private _maskWidth = Number.NaN;
  private _maskHeight = Number.NaN;
  private _children: UIElement[] = [];
  private _destroyed = false;
  private _debugLabel: string | undefined;
  private bgOpts: BackgroundOptions | undefined;
  private readonly pointerEvents: PointerEvents;
  // Transparent child that catches pointer/hover events (and the consume-input
  // fallback) across the panel's whole computed box — gaps, padding, and the
  // empty space around shrink-wrapped children, where no descendant paints.
  //
  // The box-sized hitArea lives on this childless leaf, NOT on `container`:
  // Pixi treats a container's hitArea as a subtree prune gate (see
  // EventBoundary.hitTestRecursive), so a point outside the box skips the
  // container AND every descendant. Putting it on `container` makes any child
  // that renders outside the box — an open `PixiSelect` dropdown, a
  // popover — unhittable. On a leaf the gate prunes nothing.
  //
  // Kept at the bottom of the z-order so real children (and the background)
  // win the hit test where they paint; events bubble up to `container`, and
  // the consume walk climbs from the leaf to the marked `container`.
  private readonly _hitArea = new Rectangle(0, 0, 0, 0);
  private readonly _hitCatcher: Container;

  constructor(opts: UIPanelProps) {
    this.container = new Container();
    this.yogaNode = createYogaNode();
    this._hitCatcher = new Container();
    this._hitCatcher.eventMode = "static";
    this._hitCatcher.hitArea = this._hitArea;
    this.container.addChild(this._hitCatcher);
    applyConsumeInput(this.container, opts.consumeInput);
    this.pointerEvents = new PointerEvents(this.container, opts);
    this._applyProps({ direction: "column", ...opts });
  }

  // ---------------------------------------------------------------------------
  // UIContainerElement: child management
  // ---------------------------------------------------------------------------

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
      "UIPanel.addElement",
    );
    setChildDebugLabel(child, this._debugLabel);
  }

  removeElement(child: UIElement): void {
    removeChild(
      {
        children: this._children,
        container: this.container,
        yogaNode: this.yogaNode,
      },
      child,
    );
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
      "UIPanel.insertElementBefore",
    );
    setChildDebugLabel(child, this._debugLabel);
  }

  /**
   * Name the UI tree this panel belongs to for development-mode warnings.
   * Set by `UISurface` from the owning entity and passed down the tree.
   * @internal
   */
  _setDebugLabel(label: string | undefined): void {
    this._debugLabel = label;
    setChildrenDebugLabel(this._children, label);
  }

  // ---------------------------------------------------------------------------
  // Builder methods (backward compat)
  // ---------------------------------------------------------------------------

  /** Add a text element. */
  text(content: string, style?: Partial<TextStyle>): UIText {
    const t = new UIText(
      style ? { children: content, style } : { children: content },
    );
    this.addElement(t);
    return t;
  }

  /** Add a button element. */
  button(label: string, opts: Omit<UIButtonProps, "children">): UIButton {
    const b = new UIButton({ children: label, ...opts });
    this.addElement(b);
    return b;
  }

  /** Add a nested child panel. */
  panel(opts?: UIPanelProps): UIPanel {
    const p = new UIPanel(opts ?? {});
    this.addElement(p);
    return p;
  }

  /** Add a nested scrollable viewport. */
  scrollView(opts?: UIScrollViewProps): UIScrollView {
    const sv = new UIScrollView(opts ?? {});
    this.addElement(sv);
    return sv;
  }

  // ---------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  // ---------------------------------------------------------------------------
  // Layout application (after Yoga calculateLayout)
  // ---------------------------------------------------------------------------

  /**
   * Recursively apply Yoga computed layout to PixiJS positions.
   * Call this after yogaNode.calculateLayout() on the root.
   */
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

    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();
    this._hitArea.width = w;
    this._hitArea.height = h;

    // Update background to match computed panel size
    if (this.bgRenderer && this.bgOpts) {
      this.bgRenderer.resize(w, h);
    }

    // Re-run the overflow mask draw closure only when the box it traces has
    // moved; the closure clears and refills a Graphics.
    if (this.maskHandle && (w !== this._maskWidth || h !== this._maskHeight)) {
      this._maskWidth = w;
      this._maskHeight = h;
      this.maskHandle.redraw();
    }
  }

  // ---------------------------------------------------------------------------
  // Props-driven update (for reconciler)
  // ---------------------------------------------------------------------------

  update(props: Partial<UIPanelProps>): void {
    this._applyProps(props);
    this.pointerEvents.set(props);
  }

  // ---------------------------------------------------------------------------
  // Shared prop application (used by constructor and update)
  // ---------------------------------------------------------------------------

  /**
   * Applies props by key presence (`"direction" in p`), not `!== undefined`:
   * a present key with an `undefined` value is how the React reconciler
   * marks a removed JSX prop, and each branch below resets that property to
   * its default (column direction, no gap/padding, flex-start alignment,
   * visible overflow, no background, default input-consume) rather than
   * leaving the previous value in place.
   */
  private _applyProps(p: Partial<UIPanelProps>): void {
    if ("direction" in p) {
      this.yogaNode.setFlexDirection(
        toFlexDirection(p.direction, YogaFlexDirection.Column),
      );
    }

    if ("gap" in p) {
      this.yogaNode.setGap(Gutter.All, p.gap);
    }

    if ("padding" in p) {
      const pad = resolvePadding(p.padding);
      this.yogaNode.setPadding(Edge.Top, pad.top);
      this.yogaNode.setPadding(Edge.Right, pad.right);
      this.yogaNode.setPadding(Edge.Bottom, pad.bottom);
      this.yogaNode.setPadding(Edge.Left, pad.left);
    }

    if ("alignItems" in p) {
      this.yogaNode.setAlignItems(toAlignItems(p.alignItems, Align.FlexStart));
    }
    if ("justifyContent" in p) {
      this.yogaNode.setJustifyContent(
        toJustify(p.justifyContent, Justify.FlexStart),
      );
    }

    if ("overflow" in p) {
      const overflow = p.overflow ?? "visible";
      this.yogaNode.setOverflow(
        overflow === "hidden" ? Overflow.Hidden : Overflow.Visible,
      );
      if (overflow === "hidden" && !this.maskHandle) {
        this._maskWidth = Number.NaN;
        this._maskHeight = Number.NaN;
        this.maskHandle = attachMask(
          this.container,
          graphicsMask((g) => {
            const w = this.yogaNode.getComputedWidth();
            const h = this.yogaNode.getComputedHeight();
            g.clear();
            g.rect(0, 0, w, h);
            g.fill({ color: 0xffffff });
          }),
        );
      } else if (overflow === "visible" && this.maskHandle) {
        this.maskHandle.remove();
        this.maskHandle = undefined;
      }
    }

    if ("background" in p) {
      this.bgOpts = p.background;
      if (p.background) {
        if (!this.bgRenderer) {
          this.bgRenderer = new BackgroundRenderer();
        }
        this.bgRenderer.set(p.background, this.container, 0);
      } else if (this.bgRenderer) {
        this.bgRenderer.destroy();
        this.bgRenderer = undefined;
      }
    }

    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);

    applyLayoutProps(this.yogaNode, p);

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Frees the Yoga node and destroys the Pixi container, recursing into
   * children. Idempotent — a second call is a no-op — because both the
   * React reconciler (on unmount) and a caller holding a direct reference
   * may end up calling this on the same instance.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    clearConsumeInput(this.container);
    for (const child of this._children) {
      child.destroy();
    }
    this._children.length = 0;
    this.bgRenderer?.destroy();
    this._hitCatcher.destroy();
    this.maskHandle?.remove();
    this.yogaNode.free();
    this.container.destroy();
  }
}
