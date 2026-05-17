import {
  Component,
  Transform,
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
  serializable,
} from "@yagejs/core";
import type { ReactElement } from "react";
import { createElement } from "react";
import { Container } from "pixi.js";
import {
  Anchor,
  pivotOffsetFromAnchor,
  resolveAnchor,
  UI_DEFAULT_LAYER,
  UI_DEFAULT_LAYER_ORDER,
} from "@yagejs/ui";
import type { UIPositioning } from "@yagejs/ui";
import {
  createRoot,
  addOnCommit,
  removeOnCommit,
  getRootInstances,
} from "./reconciler.js";
import type { ReconcilerRoot } from "./reconciler.js";
import { EngineCtx, SceneCtx, notifyFrame } from "./hooks.js";
import { TooltipController, TooltipOverlayCtx } from "./tooltip-overlay.js";
import { TooltipOverlayHost } from "./components.js";
import { UIReactPluginKey } from "./UIReactPlugin.js";
import { RendererKey, SceneRenderTreeKey } from "@yagejs/renderer";

/** Options for UIRoot. */
export interface UIRootOptions {
  anchor?: Anchor;
  offset?: { x: number; y: number };
  /**
   * Whether the root container marks itself as a UI auto-consume surface.
   * Default `true`: pointer events landing inside the React tree are claimed
   * by `@yagejs/input` so they don't leak through to gameplay actions. Pass
   * `false` for a transparent overlay (decorative full-screen filters,
   * cursor-following ornament, etc.) that should let clicks pass through.
   */
  consumeInput?: boolean;
  /**
   * Target layer name. Defaults to the auto-provisioned screen-space
   * `"ui"` layer. Pass the name of a layer declared on `Scene.layers`
   * to target a custom layer (e.g. a world-space layer for diegetic UI
   * that scales with the camera).
   */
  layer?: string;
  /**
   * How the tree's outer container is positioned each frame.
   *
   * - `"anchor"` (default) — resolve `anchor` against the viewport
   *   (`virtualSize`). Classic HUD behavior.
   * - `"transform"` — read `entity.get(Transform).worldPosition` in the
   *   target layer's local coord space and use `anchor` as a pivot on the
   *   rendered tree. Requires a `Transform` on the entity. Pair with
   *   `ScreenFollow` from `@yagejs/renderer` on a screen-space layer for
   *   a billboard that stays axis-aligned and constant-size, or place on
   *   a world-space layer for genuinely diegetic UI.
   */
  positioning?: UIPositioning;
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
@serializable
export class UIRoot extends Component {
  private root: ReconcilerRoot | null = null;
  private overlayRoot: ReconcilerRoot | null = null;
  private readonly _container: Container;
  /**
   * Top-most, viewport-sized, unclipped sibling that hosts floating tooltip
   * bubbles. Kept as a high-`zIndex` child of `_container` so it shares the
   * tree's coordinate space yet always draws above it and escapes any
   * `ScrollView` clip.
   */
  private readonly _overlay: Container;
  private readonly _tooltips = new TooltipController();
  private readonly _anchor: Anchor | undefined;
  private readonly _offset: { x: number; y: number };
  private readonly _layer: string | undefined;
  private readonly _positioning: UIPositioning;
  private readonly _snapshot: UIRootOptions;
  private _onCommit: (() => void) | null = null;

  constructor(opts?: UIRootOptions) {
    super();
    this._container = new Container();
    this._container.sortableChildren = true;
    this._overlay = new Container();
    this._overlay.zIndex = 1_000_000;
    if (opts?.consumeInput !== false) {
      markPointerConsumeContainer(this._container);
    }
    this._anchor = opts?.anchor;
    this._offset = opts?.offset ?? { x: 0, y: 0 };
    this._layer = opts?.layer;
    this._positioning = opts?.positioning ?? "anchor";
    this._snapshot = cloneUIRootOptions(opts);
  }

  onAdd(): void {
    if (!this.context.tryResolve(UIReactPluginKey)) {
      throw new Error(
        `UIRoot requires UIReactPlugin. Register it alongside UIPlugin: engine.use(new UIReactPlugin()).`,
      );
    }

    const tree = this.use(SceneRenderTreeKey);
    const layerName = this._layer ?? UI_DEFAULT_LAYER;
    let layer = tree.tryGet(layerName);
    if (!layer) {
      if (this._layer && this._layer !== UI_DEFAULT_LAYER) {
        throw new Error(
          `UIRoot: layer "${this._layer}" not declared on scene "${this.scene.name}".`,
        );
      }
      layer = tree.ensureLayer(
        { name: UI_DEFAULT_LAYER, order: UI_DEFAULT_LAYER_ORDER },
        { space: "screen" },
      );
    }

    if (this._positioning === "transform" && !this.entity.tryGet(Transform)) {
      throw new Error(
        `UIRoot with positioning: "transform" requires a Transform on the entity.`,
      );
    }

    layer.container.eventMode = "static";
    layer.container.addChild(this._container);

    this.root = createRoot(this._container);

    // Top overlay: a high-zIndex sibling so tooltip bubbles draw above the
    // whole tree and escape any ScrollView clip, while sharing its
    // coordinate space (both children of `_container`).
    this._container.addChild(this._overlay);
    this.overlayRoot = createRoot(this._overlay);
    this.overlayRoot.render(
      this._provide(
        createElement(TooltipOverlayHost, { controller: this._tooltips }),
      ),
    );

    // When React commits, re-run layout and anchor
    this._onCommit = () => this._layoutAndAnchor();
    addOnCommit(this._onCommit);
  }

  /** Wrap a tree in the engine/scene context providers. */
  private _provide(element: ReactElement): ReactElement {
    return createElement(
      EngineCtx.Provider,
      { value: this.context },
      createElement(SceneCtx.Provider, { value: this.scene }, element),
    );
  }

  /** Render a React element tree into this UI root. */
  render(element: ReactElement): void {
    if (!this.root) {
      throw new Error("UIRoot.render() called before onAdd().");
    }

    // Wrap in context providers so useEngine()/useScene() work, plus the
    // tooltip-overlay controller so <Tooltip> can hoist its bubble.
    this.root.render(
      this._provide(
        createElement(
          TooltipOverlayCtx.Provider,
          { value: this._tooltips },
          element,
        ),
      ),
    );
  }

  /**
   * Called each frame by ComponentUpdateSystem in Phase.Update. Ticks
   * frame-polled hooks. Actual layout runs in Phase.LateUpdate via
   * `UIRootLayoutSystem` so Transform writes from Update-phase components
   * (e.g. `ScreenFollow`) are already visible.
   */
  update(): void {
    notifyFrame();
  }

  /** @internal Run Yoga layout and anchor positioning. */
  _layoutAndAnchor(): void {
    const instances = getRootInstances(this._container);
    if (!instances || instances.length === 0) return;

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

    // Position the outer container. "anchor" resolves against the
    // viewport; "transform" pins to the entity's Transform with `anchor`
    // as a pivot on the rendered tree.
    const anchor = this._anchor;

    if (this._positioning === "transform") {
      const source = this.entity.get(Transform).worldPosition;
      if (anchor !== undefined) {
        const pivot = pivotOffsetFromAnchor(anchor, maxWidth, totalHeight);
        this._container.position.set(
          source.x + pivot.x + this._offset.x,
          source.y + pivot.y + this._offset.y,
        );
      } else {
        this._container.position.set(
          source.x + this._offset.x,
          source.y + this._offset.y,
        );
      }
    } else if (anchor !== undefined) {
      const renderer = this.use(RendererKey);
      const vs = renderer.virtualSize;
      const pos = resolveAnchor(
        anchor,
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

    // Lay out the overlay then re-anchor every bubble to its trigger's
    // post-layout geometry. The overlay is sized to the renderer's virtual
    // viewport (not `vw/vh`, which only the non-React UILayoutSystem feeds)
    // so its `100%`-sized root gives absolute bubbles a screen-sized
    // containing block — long labels stay on one line instead of wrapping
    // into the trigger's width. Kept at the container origin so its
    // coordinate space matches the tree the triggers live in.
    // The main reconciler root's initial mount calls `clearContainer`,
    // which strips every child of `_container` — including `_overlay`.
    // Re-attach it (this runs on every commit and every frame) so the
    // overlay is restored right after the user's first `render()`.
    if (this._overlay.parent !== this._container) {
      this._container.addChild(this._overlay);
    }

    const overlayInstances = getRootInstances(this._overlay);
    if (overlayInstances) {
      const vs = this.use(RendererKey).virtualSize;
      for (const inst of overlayInstances) {
        if (!inst.displayObject.visible) continue;
        inst.yogaNode.calculateLayout(vs.width, vs.height);
        inst.applyLayout?.();
        inst.displayObject.position.set(0, 0);
      }
    }
    this._tooltips.position(this._container);
  }

  onDestroy(): void {
    if (this._onCommit) removeOnCommit(this._onCommit);
    unmarkPointerConsumeContainer(this._container);
    this.overlayRoot?.unmount();
    this.overlayRoot = null;
    this.root?.unmount();
    this.root = null;
    this._overlay.removeFromParent();
    this._overlay.destroy();
    this._container.removeFromParent();
    this._container.destroy();
  }

  serialize(): UIRootOptions {
    return cloneUIRootOptions(this._snapshot);
  }

  static fromSnapshot(data: UIRootOptions): UIRoot {
    return new UIRoot(cloneUIRootOptions(data));
  }
}

function cloneUIRootOptions(opts?: UIRootOptions): UIRootOptions {
  if (!opts) return {};
  const clone: UIRootOptions = { ...opts };
  if (opts.offset) clone.offset = { ...opts.offset };
  return clone;
}
