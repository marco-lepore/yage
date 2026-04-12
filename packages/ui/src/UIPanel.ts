import { Component } from "@yagejs/core";
import { Container, Graphics } from "pixi.js";
import type { TextStyleOptions } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { FlexDirection as YogaFlexDirection, Gutter, Edge, Overflow, Display } from "yoga-layout";
import { Align, Justify } from "yoga-layout";
import { UIText } from "./UIText.js";
import { UIButton } from "./UIButton.js";
import { UIContainerKey, UILayerManagerKey, resolvePadding } from "./types.js";
import type {
  BackgroundOptions,
  UIElement,
  UIContainerElement,
  UIPanelOptions,
  UIButtonProps,
  PanelProps,
} from "./types.js";
import type { Anchor } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";

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
// PanelNode — Yoga-powered flex container
// ---------------------------------------------------------------------------

/**
 * Internal panel node used by both root UIPanel (Component) and nested child panels.
 * Manages a Yoga container node, a PixiJS Container, optional background, and
 * an ordered list of UIElement children.
 */
export class PanelNode implements UIContainerElement {
  readonly container: Container;
  readonly yogaNode: YogaNode;

  get displayObject(): Container {
    return this.container;
  }

  private bgRenderer: BackgroundRenderer | undefined;
  private mask: Graphics | undefined;
  private _children: UIElement[] = [];
  private bgOpts: BackgroundOptions | undefined;
  private _overflow: "visible" | "hidden" = "visible";

  constructor(opts: PanelProps) {
    this.container = new Container();
    this.yogaNode = createYogaNode();
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
  text(content: string, style?: Partial<TextStyleOptions>): UIText {
    const t = new UIText(style ? { children: content, style } : { children: content });
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
  panel(opts?: PanelProps): PanelNode {
    const p = new PanelNode(opts ?? {});
    this.addElement(p);
    return p;
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

    // Update background to match computed panel size
    if (this.bgRenderer && this.bgOpts) {
      const w = this.yogaNode.getComputedWidth();
      const h = this.yogaNode.getComputedHeight();
      this.bgRenderer.resize(w, h);
    }

    // Update overflow mask
    if (this._overflow === "hidden") {
      this.updateMask();
    }
  }

  private updateMask(): void {
    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();

    if (!this.mask) {
      this.mask = new Graphics();
      this.container.addChild(this.mask);
      this.container.mask = this.mask;
    }

    this.mask.clear();
    this.mask.rect(0, 0, w, h);
    this.mask.fill({ color: 0xffffff });
  }

  // ---------------------------------------------------------------------------
  // Props-driven update (for reconciler)
  // ---------------------------------------------------------------------------

  update(props: Record<string, unknown>): void {
    this._applyProps(props as PanelProps);
  }

  // ---------------------------------------------------------------------------
  // Shared prop application (used by constructor and update)
  // ---------------------------------------------------------------------------

  private _applyProps(p: PanelProps): void {
    if (p.direction !== undefined) {
      this.yogaNode.setFlexDirection(
        p.direction === "row"
          ? YogaFlexDirection.Row
          : YogaFlexDirection.Column,
      );
    }

    if (p.gap !== undefined) {
      this.yogaNode.setGap(Gutter.All, p.gap);
    }

    if (p.padding !== undefined) {
      const pad = resolvePadding(p.padding);
      this.yogaNode.setPadding(Edge.Top, pad.top);
      this.yogaNode.setPadding(Edge.Right, pad.right);
      this.yogaNode.setPadding(Edge.Bottom, pad.bottom);
      this.yogaNode.setPadding(Edge.Left, pad.left);
    }

    if (p.alignItems !== undefined) {
      this.yogaNode.setAlignItems(
        ALIGN_ITEMS_MAP[p.alignItems] ?? Align.FlexStart,
      );
    }
    if (p.justifyContent !== undefined) {
      this.yogaNode.setJustifyContent(
        JUSTIFY_MAP[p.justifyContent] ?? Justify.FlexStart,
      );
    }

    if (p.overflow !== undefined) {
      this._overflow = p.overflow;
      this.yogaNode.setOverflow(
        p.overflow === "hidden" ? Overflow.Hidden : Overflow.Visible,
      );
      if (p.overflow === "visible" && this.mask) {
        this.container.mask = null;
        this.mask.destroy();
        this.mask = undefined;
      }
    }

    if (p.background !== undefined) {
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

    applyLayoutProps(this.yogaNode, p);

    if (p.visible !== undefined) {
      this.visible = p.visible;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    for (const child of this._children) {
      child.destroy();
    }
    this._children.length = 0;
    this.bgRenderer?.destroy();
    this.mask?.destroy();
    this.yogaNode.free();
    this.container.destroy();
  }
}

// ---------------------------------------------------------------------------
// UIPanel Component (root panel, attached to an entity)
// ---------------------------------------------------------------------------

/**
 * Root UI panel component. Added to an entity via entity.add(new UIPanel({...})).
 * Provides builder methods (.text(), .button(), .panel()) for constructing UI trees.
 * Layout is driven by UILayoutSystem each frame.
 */
export class UIPanel extends Component {
  /** @internal */ readonly _node: PanelNode;
  /** @internal */ readonly _anchor: Anchor | undefined;
  /** @internal */ readonly _offset: { x: number; y: number };
  /** @internal */ readonly _layer: string | undefined;

  constructor(opts?: UIPanelOptions) {
    super();
    this._node = new PanelNode(opts ?? {});
    this._anchor = opts?.anchor;
    this._offset = opts?.offset ?? { x: 0, y: 0 };
    this._layer = opts?.layer;
  }

  /** The PixiJS Container for this panel. */
  get container(): Container {
    return this._node.container;
  }

  /** Add a text element. */
  text(content: string, style?: Partial<TextStyleOptions>): UIText {
    return this._node.text(content, style);
  }

  /** Add a button element. */
  button(label: string, opts: Omit<UIButtonProps, "children">): UIButton {
    return this._node.button(label, opts);
  }

  /** Add a nested child panel. */
  panel(opts?: PanelProps): PanelNode {
    return this._node.panel(opts);
  }

  /** Whether this panel is visible. */
  get visible(): boolean {
    return this._node.visible;
  }

  set visible(v: boolean) {
    this._node.visible = v;
  }

  onAdd(): void {
    let targetContainer: Container;
    try {
      const layerManager = this.context.resolve(UILayerManagerKey);
      if (this._layer) {
        targetContainer = layerManager.get(this._layer).container;
      } else {
        targetContainer = layerManager.defaultLayer.container;
      }
    } catch {
      // Fallback: no UILayerManager registered, use raw container
      targetContainer = this.use(UIContainerKey);
    }
    targetContainer.addChild(this._node.container);
  }

  onDestroy(): void {
    this._node.container.removeFromParent();
    this._node.destroy();
  }
}
