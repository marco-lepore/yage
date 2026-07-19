import { Container, Rectangle } from "pixi.js";
import type { TextStyle } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import {
  FlexDirection as YogaFlexDirection,
  Gutter,
  Edge,
  Overflow,
  Display,
} from "yoga-layout";
import { Align, Justify } from "yoga-layout";
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

// ---------------------------------------------------------------------------
// Enum mapping helpers
// ---------------------------------------------------------------------------

const JUSTIFY_MAP: Record<string, number> = {
  "flex-start": Justify.FlexStart,
  center: Justify.Center,
  "flex-end": Justify.FlexEnd,
  "space-between": Justify.SpaceBetween,
  "space-around": Justify.SpaceAround,
  "space-evenly": Justify.SpaceEvenly,
};

const ALIGN_ITEMS_MAP: Record<string, number> = {
  "flex-start": Align.FlexStart,
  center: Align.Center,
  "flex-end": Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
};

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
  private _children: UIElement[] = [];
  private _destroyed = false;
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
  }

  insertElementBefore(child: UIElement, before: UIElement): void {
    const beforeIdx = this._children.indexOf(before);
    if (beforeIdx === -1) {
      this.addElement(child);
      return;
    }
    this._children.splice(beforeIdx, 0, child);

    // Insert in Pixi at the correct position
    const pixiIdx = this.container.children.indexOf(before.displayObject);
    if (pixiIdx !== -1) {
      this.container.addChildAt(child.displayObject, pixiIdx);
    } else {
      this.container.addChild(child.displayObject);
    }

    this.yogaNode.insertChild(child.yogaNode, beforeIdx);
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
      const layout = child.yogaNode.getComputedLayout();
      child.displayObject.position.set(layout.left, layout.top);

      child.applyLayout?.();
    }

    warnChildOverflow(this.yogaNode, this._children);

    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();
    this._hitArea.width = w;
    this._hitArea.height = h;

    // Update background to match computed panel size
    if (this.bgRenderer && this.bgOpts) {
      this.bgRenderer.resize(w, h);
    }

    // Re-run the overflow mask draw closure with the latest dimensions.
    this.maskHandle?.redraw();
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
        p.direction === "row"
          ? YogaFlexDirection.Row
          : YogaFlexDirection.Column,
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
      this.yogaNode.setAlignItems(
        p.alignItems !== undefined
          ? (ALIGN_ITEMS_MAP[p.alignItems] ?? Align.FlexStart)
          : Align.FlexStart,
      );
    }
    if ("justifyContent" in p) {
      this.yogaNode.setJustifyContent(
        p.justifyContent !== undefined
          ? (JUSTIFY_MAP[p.justifyContent] ?? Justify.FlexStart)
          : Justify.FlexStart,
      );
    }

    if ("overflow" in p) {
      const overflow = p.overflow ?? "visible";
      this.yogaNode.setOverflow(
        overflow === "hidden" ? Overflow.Hidden : Overflow.Visible,
      );
      if (overflow === "hidden" && !this.maskHandle) {
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
