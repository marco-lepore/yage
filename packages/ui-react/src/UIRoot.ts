import { Component } from "@yagejs/core";
import type { ReactElement } from "react";
import { createElement } from "react";
import { Container } from "pixi.js";
import {
  Anchor,
  UIContainerKey,
  resolveAnchor,
} from "@yagejs/ui";
import {
  createRoot,
  addOnCommit,
  removeOnCommit,
  getRootInstances,
} from "./reconciler.js";
import type { ReconcilerRoot } from "./reconciler.js";
import { EngineCtx, SceneCtx, notifyFrame } from "./hooks.js";
import { RendererKey } from "@yagejs/renderer";

/** Options for UIRoot. */
export interface UIRootOptions {
  anchor?: Anchor;
  offset?: { x: number; y: number };
}

/**
 * YAGE Component that hosts a React tree in the UI layer.
 *
 * Usage:
 * ```ts
 * const root = entity.add(new UIRoot({ anchor: Anchor.Center }));
 * root.render(<MyMenu />);
 * ```
 */
export class UIRoot extends Component {
  private root: ReconcilerRoot | null = null;
  private readonly _container: Container;
  private readonly _anchor: Anchor | undefined;
  private readonly _offset: { x: number; y: number };
  private _onCommit: (() => void) | null = null;

  constructor(opts?: UIRootOptions) {
    super();
    this._container = new Container();
    this._anchor = opts?.anchor;
    this._offset = opts?.offset ?? { x: 0, y: 0 };
  }

  onAdd(): void {
    const uiContainer = this.use(UIContainerKey);
    uiContainer.addChild(this._container);

    this.root = createRoot(this._container);

    // When React commits, re-run layout and anchor
    this._onCommit = () => this._layoutAndAnchor();
    addOnCommit(this._onCommit);
  }

  /** Render a React element tree into this UI root. */
  render(element: ReactElement): void {
    if (!this.root) {
      throw new Error("UIRoot.render() called before onAdd().");
    }

    // Wrap in context providers so useEngine()/useScene() work
    const wrapped = createElement(
      EngineCtx.Provider,
      { value: this.context },
      createElement(
        SceneCtx.Provider,
        { value: this.scene },
        element,
      ),
    );

    this.root.render(wrapped);
  }

  /** Called each frame by ComponentUpdateSystem. Ticks frame-polled hooks then re-layouts. */
  update(): void {
    notifyFrame();
    this._layoutAndAnchor();
  }

  /** @internal Run Yoga layout and anchor positioning. */
  private _layoutAndAnchor(): void {
    const instances = getRootInstances(this._container);
    if (!instances || instances.length === 0) return;

    // Create a temporary root Yoga node to hold all top-level instances
    // and compute their layout together
    const renderer = this.use(RendererKey);
    const vs = renderer.virtualSize;

    // For each root instance that is a PanelNode, run Yoga layout
    let totalHeight = 0;
    let maxWidth = 0;

    for (const inst of instances) {
      if (!inst.displayObject.visible) continue;

      // Run Yoga layout (undefined = shrink-to-content)
      inst.yogaNode.calculateLayout(undefined, undefined);

      // Apply layout recursively
      inst.applyLayout?.();

      const w = inst.yogaNode.getComputedWidth();
      const h = inst.yogaNode.getComputedHeight();

      // Stack root elements vertically
      inst.displayObject.position.set(0, totalHeight);
      totalHeight += h;
      maxWidth = Math.max(maxWidth, w);
    }

    // Resolve anchor
    if (this._anchor !== undefined) {
      const pos = resolveAnchor(
        this._anchor,
        vs.width,
        vs.height,
        maxWidth,
        totalHeight,
      );
      this._container.position.set(
        pos.x + this._offset.x,
        pos.y + this._offset.y,
      );
    } else {
      this._container.position.set(this._offset.x, this._offset.y);
    }
  }

  onDestroy(): void {
    if (this._onCommit) removeOnCommit(this._onCommit);
    this.root?.unmount();
    this.root = null;
    this._container.removeFromParent();
    this._container.destroy();
  }
}
