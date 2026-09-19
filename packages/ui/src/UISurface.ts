import { Component, ErrorBoundaryKey, Transform } from "@yagejs/core";
import type { TextStyle } from "@yagejs/renderer";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import type { DisplayContainer } from "@yagejs/renderer";
import { UIPanel } from "./UIPanel.js";
import { UIFocusStackKey } from "./focus/UIFocusStack.js";
import type { UIFocusScope } from "./focus/UIFocusScope.js";
import type { UIText } from "./UIText.js";
import type { UIButton } from "./UIButton.js";
import type { UIScrollView } from "./UIScrollView.js";
import { UI_DEFAULT_LAYER, UI_DEFAULT_LAYER_ORDER } from "./types.js";
import type {
  UISurfaceOptions,
  UIButtonProps,
  UIPanelProps,
  PointerEventProps,
  UIScrollViewProps,
  UIElement,
  UITextBuilderProps,
} from "./types.js";
import type { Anchor } from "./types.js";
import { bindUIErrorBoundary } from "./error-boundary.js";

/** A non-finite offset would reach the tree's position on every layout pass. */
function finiteOffset(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite, got ${value}.`);
  }
  return value;
}

/**
 * Mounts a UI tree on an entity: `entity.add(new UISurface({...}))`.
 * Owns the tree's root `UIPanel` element (exposed as `root`) and provides
 * builder methods (`.text()`, `.button()`, `.panel()`) for constructing it.
 * Layout is driven by UILayoutSystem each frame.
 */
export class UISurface extends Component {
  /**
   * Root element of the mounted UI tree — a `UIPanel` created with this
   * component and destroyed by it in `onDestroy`. Same instance for the
   * component's whole lifetime; after `onDestroy` it is destroyed (its
   * `destroy()` is idempotent) and must not be re-added elsewhere.
   */
  readonly root: UIPanel;
  /** @internal */ readonly _anchor: Anchor | undefined;
  /** @internal */ readonly _offset: { x: number; y: number };
  /** @internal */ readonly _layer: string | undefined;
  /** @internal */ readonly _positioning: "anchor" | "transform";
  /** The visibility the game asked for; the tree also needs the entity active. */
  private _userVisible: boolean;

  constructor(opts?: UISurfaceOptions) {
    super();
    // `focus` goes to the root panel with the rest of the options. One
    // container hosts one scope, and a root panel's own scope searches exactly
    // the children a surface-level scope would, so `surface.focusScope` and
    // `root.focusScope` name the one scope however the option arrives — at
    // construction or through a later `root.update({ focus })`.
    this.root = new UIPanel(opts ?? {});
    this._userVisible = opts?.visible ?? true;
    this._anchor = opts?.anchor;
    // Copied so `setOffset` writes this surface's own object, never the one
    // the caller passed in.
    const offset = opts?.offset;
    this._offset = {
      x: offset ? finiteOffset(offset.x, "UISurface: offset.x") : 0,
      y: offset ? finiteOffset(offset.y, "UISurface: offset.y") : 0,
    };
    this._layer = opts?.layer;
    this._positioning = opts?.positioning ?? "anchor";
  }

  /**
   * Move the whole tree by a screen-space offset, on top of whatever its
   * anchor or transform positioning resolves to. Animating a sliding panel is
   * a `setOffset` per frame.
   */
  setOffset(x: number, y: number): void {
    finiteOffset(x, "UISurface.setOffset: x");
    finiteOffset(y, "UISurface.setOffset: y");
    this._offset.x = x;
    this._offset.y = y;
  }

  /** The offset the tree is drawn at. */
  get offset(): Readonly<{ x: number; y: number }> {
    return this._offset;
  }

  /** The PixiJS Container of the root panel. */
  get container(): DisplayContainer {
    return this.root.container;
  }

  /**
   * The scope `UISurfaceOptions.focus` asks for, or `null` when the surface
   * carries none. It is the root panel's scope, so `surface.focusScope` and
   * `surface.root.focusScope` are the same object, and passing `focus` again
   * through `root.update()` refreshes that scope rather than replacing it.
   */
  get focusScope(): UIFocusScope | null {
    return this.root.focusScope;
  }

  /**
   * Set the root panel's pointer / hover handlers (`onHover`,
   * `onPointerOver`, `onPointerOut`) after construction — forwarded to
   * `root`. (`update()` can't double as the prop setter here: on a
   * `Component` it's the per-frame lifecycle hook the engine calls.) Like
   * the element `update`, a present key replaces that handler and an absent
   * key leaves it intact, so a partial `setPointerHandlers({ onHover })`
   * won't drop the others. Handy for wiring `attachTooltip`:
   * `surface.setPointerHandlers({ onHover: tip.setActive })`.
   */
  setPointerHandlers(handlers: PointerEventProps): void {
    this.root.update(handlers);
  }

  /** Add a text element. See {@link UIPanel.text} for `opts`. */
  text(
    content: string,
    style?: Partial<TextStyle>,
    opts?: UITextBuilderProps,
  ): UIText {
    return this.root.text(content, style, opts);
  }

  /** Add a button element. */
  button(label: string, opts: Omit<UIButtonProps, "children">): UIButton {
    return this.root.button(label, opts);
  }

  /** Add a nested child panel. */
  panel(opts?: UIPanelProps): UIPanel {
    return this.root.panel(opts);
  }

  /** Add a nested scrollable viewport. */
  scrollView(opts?: UIScrollViewProps): UIScrollView {
    return this.root.scrollView(opts);
  }

  /**
   * Append an arbitrary `UIElement` (e.g. `UIImage`, `UIProgressBar`,
   * `UICheckbox`) as the last child. Prefer the `.text()`, `.button()`,
   * and `.panel()` builders for those element types — they're shorter.
   */
  addElement(child: UIElement): void {
    this.root.addElement(child);
  }

  /** Remove a previously added element. No-op if the element isn't a child. */
  removeElement(child: UIElement): void {
    this.root.removeElement(child);
  }

  /**
   * Insert `child` immediately before `before` in the root panel's child
   * list. Falls back to append if `before` isn't a current child.
   */
  insertElementBefore(child: UIElement, before: UIElement): void {
    this.root.insertElementBefore(child, before);
  }

  /**
   * Whether the mounted UI tree is visible. Reads back what you set, even
   * while the entity is dormant and the tree is hidden.
   */
  get visible(): boolean {
    return this._userVisible;
  }

  set visible(v: boolean) {
    this._userVisible = v;
    this.root.visible = v && this.effectiveEnabled;
  }

  onEnable(): void {
    this.root.visible = this._userVisible;
  }

  onDisable(): void {
    this.root.visible = false;
  }

  onAdd(): void {
    // Hand the tree what it needs to know about itself: the entity name
    // development-mode layout warnings print, and the scene's focus stack. The
    // root passes it to the children already built, and to every child added
    // later, so both build orders — children before `entity.add`, children
    // after — end up with it.
    //
    // `tryResolveScoped`, not `use`: the key is registered by `UIPlugin`'s
    // scene hook, and a surface in a scene whose hooks never ran — a unit-test
    // harness, a scene built by hand — would otherwise fail on add for a
    // feature it does not use.
    const focusStack = this.scene.tryResolveScoped(UIFocusStackKey) ?? null;
    this.root._attachToTree({ label: this.entity.name, focusStack });
    bindUIErrorBoundary(this.root.container, this.use(ErrorBoundaryKey));
    const tree = this.use(SceneRenderTreeKey);
    const layerName = this._layer ?? UI_DEFAULT_LAYER;
    let layer = tree.tryGet(layerName);
    if (!layer) {
      if (this._layer && this._layer !== UI_DEFAULT_LAYER) {
        throw new Error(
          `UISurface: layer "${this._layer}" not declared on scene "${this.scene.name}".`,
        );
      }
      // Auto-provision the default "ui" layer on first use so a bare
      // `new UISurface()` works without any scene layer wiring. Screen-space
      // keeps the HUD fixed under the default camera.
      layer = tree.ensureLayer(
        { name: UI_DEFAULT_LAYER, order: UI_DEFAULT_LAYER_ORDER },
        { space: "screen" },
      );
    }

    // `positioning: "transform"` reads `entity.get(Transform).worldPosition`
    // each frame — fail fast if the entity doesn't have one.
    if (this._positioning === "transform" && !this.entity.tryGet(Transform)) {
      throw new Error(
        `UISurface with positioning: "transform" requires a Transform on the entity.`,
      );
    }

    layer.container.eventMode = "static";
    layer.container.addChild(this.root.container);
    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity. Start hidden so a tree
    // mounted on a dormant entity doesn't show before it should.
    this.root.visible = false;
  }

  onDestroy(): void {
    // Every scope in the tree, the root's own included, leaves the stack as
    // `root.destroy()` detaches the tree element by element.
    this.root.container.removeFromParent();
    this.root.destroy();
  }
}
