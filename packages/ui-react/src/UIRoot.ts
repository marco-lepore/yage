import {
  Component,
  ErrorBoundaryKey,
  Transform,
  Vec2Buffer,
  devWarn,
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
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
  UIFocusScope,
  UIFocusStackKey,
  bindUIErrorBoundary,
} from "@yagejs/ui";
import type {
  UIElement,
  UIFocusScopeOptions,
  UIFocusStack,
  UIPositioning,
  UITreeContext,
} from "@yagejs/ui";
import {
  createRoot,
  addOnCommit,
  removeOnCommit,
  getRootInstances,
} from "./reconciler.js";
import type { ReconcilerRoot } from "./reconciler.js";
import { EngineCtx, SceneCtx, notifyFrame } from "./hooks.js";
import { FloatingOverlayCtx, FloatingOverlayKey } from "./floating.js";
import type { FloatingOverlay } from "./floating.js";
import { UIReactPluginKey } from "./UIReactPlugin.js";
import { RendererKey, SceneRenderTreeKey } from "@yagejs/renderer";

/** A non-finite offset would reach the tree's position on every layout pass. */
function finiteOffset(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite, got ${value}.`);
  }
  return value;
}

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
  /**
   * Make the whole React tree one keyboard- and gamepad-navigable focus
   * scope over the elements it commits at the top level. `true` takes every
   * scope default; an object names the ones to change.
   *
   * Use this when the tree's outermost element is not a single `<Panel>`;
   * otherwise `<Panel focus>` is the usual form.
   */
  focus?: boolean | UIFocusScopeOptions;
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
  private readonly positionScratch = new Vec2Buffer();
  private root: ReconcilerRoot | null = null;
  private readonly _container: Container;
  private _floating: FloatingOverlay | null = null;
  private readonly _anchor: Anchor | undefined;
  private readonly _offset: { x: number; y: number };
  private readonly _layer: string | undefined;
  private readonly _positioning: UIPositioning;
  private readonly _focusOption: boolean | UIFocusScopeOptions | undefined;
  private _focusScope: UIFocusScope | null = null;
  private _focusStack: UIFocusStack | null = null;
  private _treeContext: UITreeContext | null = null;
  private _stamped = new WeakSet<UIElement>();
  private _onCommit: (() => void) | null = null;

  constructor(opts?: UIRootOptions) {
    super();
    this._container = new Container();
    if (opts?.consumeInput !== false) {
      markPointerConsumeContainer(this._container);
    }
    this._anchor = opts?.anchor;
    // Copied so `setOffset` writes this root's own object, never the one the
    // caller passed in.
    const offset = opts?.offset;
    this._offset = {
      x: offset ? finiteOffset(offset.x, "UIRoot: offset.x") : 0,
      y: offset ? finiteOffset(offset.y, "UIRoot: offset.y") : 0,
    };
    this._layer = opts?.layer;
    this._positioning = opts?.positioning ?? "anchor";
    this._focusOption = opts?.focus;
  }

  /**
   * The focus scope covering the whole React tree, or `null` when the root
   * carries no `focus` option. A `<Panel focus>` inside the tree owns its own
   * scope, reached through that panel.
   */
  get focusScope(): UIFocusScope | null {
    return this._focusScope;
  }

  onAdd(): void {
    if (!this.context.tryResolve(UIReactPluginKey)) {
      throw new Error(
        `UIRoot requires UIReactPlugin. Register it alongside UIPlugin: engine.use(new UIReactPlugin()).`,
      );
    }

    bindUIErrorBoundary(this._container, this.use(ErrorBoundaryKey));
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
    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity. Start hidden so a tree
    // mounted on a dormant entity is neither painted nor hit-tested.
    this._container.visible = false;

    this.root = createRoot(this._container);
    this._buildFocusScope();

    // Resolve the scene-level overlay so the React context Provider can hand
    // it to <Tooltip>/useFloating. The overlay layer is attached + ticked by
    // `@yagejs/ui`'s `FloatingOverlaySystem`, not here — so floating UI works
    // with or without a `UIRoot`.
    this._floating = this.use(FloatingOverlayKey);

    // When React commits, stamp the new elements and re-run layout and anchor
    this._onCommit = () => {
      this._applyTreeContext();
      this._layoutAndAnchor();
    };
    addOnCommit(this._onCommit);
  }

  /**
   * Hand the tree the entity name that development warnings print, and the
   * scene's focus stack.
   *
   * Only an element not yet stamped is visited. Stamping recurses into a
   * container's subtree and rebuilds the scopes it finds, so stamping every
   * element on every commit would walk the whole tree on each state change. A
   * container passes its context to every child added later, which covers the
   * deeper elements of a later render.
   *
   * `tryResolveScoped`, not `use`: `UIPlugin`'s scene hook registers the
   * focus stack, and a scene whose hooks never ran must not fail on commit.
   */
  private _applyTreeContext(): void {
    const instances = getRootInstances(this._container);
    if (!instances) return;
    const label = this.entity.name;
    const focusStack = this.scene.tryResolveScoped(UIFocusStackKey) ?? null;
    let context = this._treeContext;
    if (
      context === null ||
      context.label !== label ||
      context.focusStack !== focusStack
    ) {
      context = { label, focusStack };
      this._treeContext = context;
      this._stamped = new WeakSet();
    }
    const stamped = this._stamped;
    for (const inst of instances) {
      if (stamped.has(inst)) continue;
      stamped.add(inst);
      inst._attachToTree?.(context);
    }
  }

  /**
   * Build the scope `UIRootOptions.focus` asks for. A React tree has no
   * single root element, and every commit may replace the top-level ones, so
   * the scope searches whatever the current commit left at the top and
   * measures candidates against this root's own container.
   */
  private _buildFocusScope(): void {
    const option = this._focusOption;
    if (option === undefined || option === false) return;
    const scope = new UIFocusScope(
      {
        displayObject: this._container,
        roots: () => getRootInstances(this._container) ?? [],
      },
      option === true ? {} : option,
    );
    this._focusScope = scope;
    const stack = this.scene.tryResolveScoped(UIFocusStackKey);
    if (!stack) {
      // The same sentence a `focus` panel and a `focus` surface print.
      // `@yagejs/ui` keeps its warning helper internal, so this is a copy; the
      // test beside this file pins the wording.
      devWarn(
        `UIRoot on entity "${this.entity.name}" has no focus stack, so its ` +
          "focus scope reads no keyboard or gamepad input. UIPlugin " +
          "registers one per scene as the scene is entered.",
      );
      return;
    }
    this._focusStack = stack;
    stack._register(scope);
  }

  private _disposeFocusScope(): void {
    const scope = this._focusScope;
    if (scope === null) return;
    this._focusScope = null;
    this._focusStack?._unregister(scope);
    this._focusStack = null;
    scope._destroy();
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
    // scene floating overlay so <Tooltip> can portal its bubble.
    this.root.render(
      this._provide(
        createElement(
          FloatingOverlayCtx.Provider,
          { value: this._floating },
          element,
        ),
      ),
    );
  }

  /**
   * Move the whole tree by a screen-space offset, on top of whatever its
   * anchor or transform positioning resolves to. Animating a sliding panel is
   * a `setOffset` per frame.
   */
  setOffset(x: number, y: number): void {
    finiteOffset(x, "UIRoot.setOffset: x");
    finiteOffset(y, "UIRoot.setOffset: y");
    this._offset.x = x;
    this._offset.y = y;
  }

  /** The offset the tree is drawn at. */
  get offset(): Readonly<{ x: number; y: number }> {
    return this._offset;
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

    // For each root instance that is a UIPanel, run Yoga layout
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
      const source = this.entity
        .get(Transform)
        .getWorldPositionInto(this.positionScratch);
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
  }

  onEnable(): void {
    this._container.visible = true;
  }

  /** Hiding the container also takes the React tree out of pointer hit-testing. */
  onDisable(): void {
    this._container.visible = false;
  }

  onDestroy(): void {
    if (this._onCommit) removeOnCommit(this._onCommit);
    this._disposeFocusScope();
    unmarkPointerConsumeContainer(this._container);
    this.root?.unmount();
    this.root = null;
    this._floating = null;
    this._container.removeFromParent();
    this._container.destroy();
  }
}
