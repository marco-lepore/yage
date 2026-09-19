import { Container, Rectangle } from "pixi.js";
import type { TextStyle } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { Edge, Overflow, Display } from "yoga-layout";
import { attachMask, graphicsMask } from "@yagejs/renderer";
import type { DisplayContainer, MaskHandle } from "@yagejs/renderer";
import { UIText } from "./UIText.js";
import { UIButton } from "./UIButton.js";
import { UIScrollView } from "./UIScrollView.js";
import { isTextureBackground, resolvePadding } from "./types.js";
import type {
  BackgroundOptions,
  UIElement,
  UIContainerElement,
  UIButtonProps,
  UIFocusScopeOptions,
  UIPanelProps,
  UIScrollViewProps,
  UITextBuilderProps,
} from "./types.js";
import {
  createYogaNode,
  applyLayoutProps,
  warnChildOverflow,
} from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "./focus/pointer-request.js";
import { UIFocusScope } from "./focus/UIFocusScope.js";
import type { UIFocusStack } from "./focus/UIFocusStack.js";
import { FocusOutline, layoutBox } from "./internal/focus-outline.js";
import {
  addChild,
  insertChildBefore,
  removeChild,
} from "./internal/child-list.js";
import {
  attachChildToTree,
  attachChildrenToTree,
  detachChildFromTree,
} from "./internal/tree-context.js";
import type { UITreeContext } from "./internal/tree-context.js";
import {
  describeTree,
  warnMissingFocusStack,
} from "./internal/focus-stack-warning.js";
import { applyFlexContainerProps } from "./internal/flex-container.js";
import type { FlexContainerDefaults } from "./internal/flex-container.js";

/** What a panel's container props fall back to when one is dropped. */
const PANEL_DEFAULTS: FlexContainerDefaults = {
  direction: "column",
  alignItems: "flex-start",
  justifyContent: "flex-start",
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
  // Size the overflow mask was last drawn at. `NaN` never equals a computed
  // size, so the first draw after the mask is created always gets through.
  private _maskWidth = Number.NaN;
  private _maskHeight = Number.NaN;
  private _children: UIElement[] = [];
  private _destroyed = false;
  private _treeContext: UITreeContext | undefined;
  private _debugLabel: string | undefined;
  private bgOpts: BackgroundOptions | undefined;
  // The fill a focused panel paints, only where the caller named one.
  private focusBgOpts: BackgroundOptions | undefined;
  private focusBgOverride: BackgroundOptions | undefined;
  private _isFocused = false;
  private readonly pointerEvents: PointerEvents;
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;
  /** What the caller asked for, kept until a tree context can honour it. */
  private _focusOption: boolean | UIFocusScopeOptions | undefined;
  private _focusScope: UIFocusScope | null = null;
  /** The stack the scope is registered with, which teardown unregisters from. */
  private _focusStack: UIFocusStack | null = null;
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
    // A focusable row takes focus from the pointer the way a button does.
    // Pixi dispatches pointer events along the whole composed path, so a
    // button inside this row asks too; the deepest request of a tick wins,
    // which puts focus on the element the pointer is over. A row that takes
    // no part in focus navigation asks for nothing, which the cell decides.
    this.container.on("pointerover", () => {
      requestHoverFocus(this);
    });
    this.container.on("pointerdown", () => {
      requestPressFocus(this);
    });
    // Ahead of the props: `_applyProps` refreshes the outline when it takes a
    // background, whose corner radius the outline follows.
    this._focusOutline = new FocusOutline({
      container: this.container,
      box: () => layoutBox(this.yogaNode, this._bgRadius()),
    });
    this._applyProps({ direction: "column", ...opts });
    this._focusOutline.set(opts);
    this._focus = new FocusState(this, opts, {
      focusableByDefault: false,
      paint: (focused) => {
        this._isFocused = focused;
        this._focusOutline.setFocused(focused);
        this._paintBg();
      },
    });
  }

  /** The corner radius the outline follows, from the resting background. */
  private _bgRadius(): number | undefined {
    const base = this.bgOpts;
    if (base === undefined || isTextureBackground(base)) return undefined;
    return base.radius;
  }

  /**
   * The focus scope this panel owns, or `null` when it carries no `focus`
   * option. A panel built before its tree is mounted gets its scope the
   * moment the tree context arrives.
   */
  get focusScope(): UIFocusScope | null {
    return this._focusScope;
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
    attachChildToTree(child, this._treeContext);
  }

  removeElement(child: UIElement): void {
    const removed = removeChild(
      {
        children: this._children,
        container: this.container,
        yogaNode: this.yogaNode,
      },
      child,
    );
    if (removed) detachChildFromTree(child);
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
    attachChildToTree(child, this._treeContext);
  }

  /**
   * Take the context of the UI tree this panel belongs to: the name
   * development-mode warnings print, and the scene's focus stack. Stamped by
   * `UISurface` from the owning entity and passed down the tree.
   * @internal
   */
  _attachToTree(context: UITreeContext): void {
    this._treeContext = context;
    this._debugLabel = context.label;
    // Before the children, so scopes register from the root of the tree down
    // and this panel owns its own before its subtree joins.
    this._syncFocusScope();
    attachChildrenToTree(this._children, context);
  }

  /** @internal */
  _detachFromTree(): void {
    this._disposeFocusScope();
    // A panel holding no context handed none down, so its subtree carries
    // none either. Destroying a tree reaches each panel twice — once from the
    // parent's walk, once from its own `destroy()` — and the second visit
    // stops here rather than walking the subtree again.
    if (this._treeContext === undefined) return;
    this._treeContext = undefined;
    this._debugLabel = undefined;
    for (const child of this._children) detachChildFromTree(child);
  }

  // ---------------------------------------------------------------------------
  // Builder methods (backward compat)
  // ---------------------------------------------------------------------------

  /**
   * Add a text element. `opts` carries the rest of {@link UITextProps} —
   * `bitmap`, `resolution`, `truncate`, layout props — so the builder reaches
   * everything the `UIText` constructor does.
   */
  text(
    content: string,
    style?: Partial<TextStyle>,
    opts?: UITextBuilderProps,
  ): UIText {
    const t = new UIText({
      ...opts,
      children: content,
      ...(style ? { style } : {}),
    });
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

    // Whatever the panel is painting — its resting background or the fill it
    // took with focus — follows the box.
    this.bgRenderer?.resize(w, h);

    // Re-run the overflow mask draw closure only when the box it traces has
    // moved; the closure clears and refills a Graphics.
    if (this.maskHandle && (w !== this._maskWidth || h !== this._maskHeight)) {
      this._maskWidth = w;
      this._maskHeight = h;
      this.maskHandle.redraw();
    }

    this._focusOutline.refresh();
  }

  // ---------------------------------------------------------------------------
  // Props-driven update (for reconciler)
  // ---------------------------------------------------------------------------

  update(props: Partial<UIPanelProps>): void {
    this._applyProps(props);
    this.pointerEvents.set(props);
    this._focus.set(props);
    this._focusOutline.set(props);
  }

  /**
   * What the Inspector reports for this panel: which scope holds the keys,
   * and whether the panel itself is focused in the scope that owns it —
   * true only for a `focusable` panel, such as a stepper row built with
   * `focusable` plus `onAdjust`. A test reads this instead of a screenshot.
   * @internal
   */
  _inspectState(): {
    focusScope: { hasInput: boolean } | null;
    focused: boolean;
    focusable: boolean;
  } {
    const scope = this._focusScope;
    return {
      focusScope: scope === null ? null : { hasInput: scope.hasInput },
      focused: this._isFocused,
      focusable: this._focus.focusable,
    };
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
    applyFlexContainerProps(this.yogaNode, p, PANEL_DEFAULTS);

    if ("padding" in p) {
      const pad = resolvePadding(p.padding);
      this.yogaNode.setPadding(Edge.Top, pad.top);
      this.yogaNode.setPadding(Edge.Right, pad.right);
      this.yogaNode.setPadding(Edge.Bottom, pad.bottom);
      this.yogaNode.setPadding(Edge.Left, pad.left);
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

    if ("background" in p) this.bgOpts = p.background;

    if ("background" in p || "focusBackground" in p) {
      // A new resting background re-resolves the focused fill and the corner
      // radius the outline follows, so a recoloured panel stays in step.
      if ("focusBackground" in p) this.focusBgOverride = p.focusBackground;
      this.focusBgOpts = this._resolveFocusBg();
      this._paintBg();
      this._focusOutline.refresh();
    }

    if ("focus" in p) {
      this._focusOption = p.focus;
      this._syncFocusScope();
    }

    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);

    applyLayoutProps(this.yogaNode, p);

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  // ---------------------------------------------------------------------------
  // Focus
  // ---------------------------------------------------------------------------

  /**
   * The fill a focused panel paints: the caller's `focusBackground` and
   * nothing else, so a game that named no fill shows focus the way it asked
   * for elsewhere — an outline from `focusStyle`, or its own painting from
   * `onFocusChange`. A colour override fills in over the resting background,
   * so an override giving only a colour keeps the resting corner radius. A
   * panel with no `background` of its own takes the override whole, which is
   * the menu row that is transparent at rest and filled while focused.
   */
  private _resolveFocusBg(): BackgroundOptions | undefined {
    const base = this.bgOpts;
    const override = this.focusBgOverride;
    if (override === undefined) return undefined;
    if (base === undefined) return override;
    if (isTextureBackground(override) || isTextureBackground(base)) {
      return override;
    }
    return { ...base, ...override };
  }

  /**
   * Paint the fill the panel's current focus state calls for, and nothing at
   * all when that state names none: the display object goes with it, so a row
   * that is transparent at rest leaves no empty rectangle behind when focus
   * moves off it. The renderer stays, holding nothing, and draws again from
   * the next fill it is given.
   *
   * The renderer draws at the box the last layout pass computed rather than
   * waiting for the next one, so a fill arriving with a focus change is on
   * screen in the frame it was asked for.
   */
  private _paintBg(): void {
    const painted =
      (this._isFocused ? this.focusBgOpts : undefined) ?? this.bgOpts;
    if (painted === undefined) {
      this.bgRenderer?.destroy();
      return;
    }
    const renderer = (this.bgRenderer ??= new BackgroundRenderer());
    renderer.set(painted, this.container, 0);
    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();
    if (Number.isFinite(w) && Number.isFinite(h)) renderer.resize(w, h);
  }

  /**
   * Build, refresh or drop the scope this panel's `focus` option asks for.
   *
   * An option arriving for a scope that exists refreshes it in place rather
   * than rebuilding it: the React reconciler passes every prop on every
   * commit with a fresh object literal, so rebuilding would drop focus on
   * each unrelated state change. Building waits for the tree context, so a
   * panel filled before its surface reaches an entity works too.
   */
  private _syncFocusScope(): void {
    const option = this._focusOption;
    if (option === undefined || option === false) {
      this._disposeFocusScope();
      return;
    }
    const options = option === true ? {} : option;
    const context = this._treeContext;
    const existing = this._focusScope;
    if (existing !== null) {
      existing.setOptions(options);
      this._registerScope(existing, context?.focusStack ?? null);
      return;
    }
    if (context === undefined) return;
    const scope = new UIFocusScope(
      {
        displayObject: this.container,
        roots: () => this._children,
      },
      options,
    );
    this._focusScope = scope;
    this._registerScope(scope, context.focusStack);
    if (context.focusStack === null) {
      warnMissingFocusStack(`UIPanel in ${describeTree(context.label)}`);
    }
  }

  /** Move the scope to `stack`, so one stack holds it at a time. */
  private _registerScope(
    scope: UIFocusScope,
    stack: UIFocusStack | null,
  ): void {
    if (stack === this._focusStack) return;
    this._focusStack?._unregister(scope);
    this._focusStack = stack;
    stack?._register(scope);
  }

  private _disposeFocusScope(): void {
    const scope = this._focusScope;
    if (scope === null) return;
    this._focusScope = null;
    this._focusStack?._unregister(scope);
    this._focusStack = null;
    scope._destroy();
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
    this._detachFromTree();
    this._focus.destroy();
    this._focusOutline.destroy();
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
