import { Component, LocalizationKey, Transform, serializable } from "@yagejs/core";
import type { LocalizableText } from "@yagejs/core";
import type { TextStyle } from "@yagejs/renderer";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import type { DisplayContainer } from "@yagejs/renderer";
import { UIPanel } from "./UIPanel.js";
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
} from "./types.js";
import type { Anchor } from "./types.js";

/**
 * Mounts a UI tree on an entity: `entity.add(new UISurface({...}))`.
 * Owns the tree's root `UIPanel` element (exposed as `root`) and provides
 * builder methods (`.text()`, `.button()`, `.panel()`) for constructing it.
 * Layout is driven by UILayoutSystem each frame.
 */
@serializable
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
  private readonly _snapshot: UISurfaceOptions;
  /** The visibility the game asked for; the tree also needs the entity active. */
  private _userVisible: boolean;

  constructor(opts?: UISurfaceOptions) {
    super();
    this.root = new UIPanel(opts ?? {});
    this._userVisible = opts?.visible ?? true;
    this._anchor = opts?.anchor;
    this._offset = opts?.offset ?? { x: 0, y: 0 };
    this._layer = opts?.layer;
    this._positioning = opts?.positioning ?? "anchor";
    this._snapshot = cloneUISurfaceOptions(opts);
  }

  /** The PixiJS Container of the root panel. */
  get container(): DisplayContainer {
    return this.root.container;
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

  /** Add a text element — a literal or a {@link LocalizedBinding} (via `msg`). */
  text(content: LocalizableText, style?: Partial<TextStyle>): UIText {
    return this.root.text(content, style);
  }

  /** Add a button element — label may be a literal or a {@link LocalizedBinding}. */
  button(label: LocalizableText, opts: Omit<UIButtonProps, "children">): UIButton {
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

    // Bind the whole tree to the scene's localization service (if any) so
    // LocalizedBinding text re-resolves on locale change. `undefined` when no
    // plugin is registered — bindings then render their default.
    this.root.attachLocalization(this.context.tryResolve(LocalizationKey));
  }

  onDestroy(): void {
    this.root.detachLocalization();
    this.root.container.removeFromParent();
    this.root.destroy();
  }

  serialize(): UISurfaceOptions {
    return cloneUISurfaceOptions(this._snapshot);
  }

  static fromSnapshot(data: UISurfaceOptions): UISurface {
    return new UISurface(cloneUISurfaceOptions(data));
  }
}

function cloneUISurfaceOptions(opts?: UISurfaceOptions): UISurfaceOptions {
  if (!opts) return {};
  const clone: UISurfaceOptions = { ...opts };
  if (opts.offset) clone.offset = { ...opts.offset };
  if (opts.padding !== undefined) {
    clone.padding =
      typeof opts.padding === "number" ? opts.padding : { ...opts.padding };
  }
  if (opts.margin !== undefined) {
    clone.margin =
      typeof opts.margin === "number" ? opts.margin : { ...opts.margin };
  }
  if (opts.background) {
    const bg = { ...opts.background };
    // TextureBackground.nineSlice / tileScale can be objects; deep-copy them
    // so mutations to the clone don't leak back into the original options.
    if ("nineSlice" in bg && bg.nineSlice && typeof bg.nineSlice === "object") {
      bg.nineSlice = { ...bg.nineSlice };
    }
    if ("tileScale" in bg && bg.tileScale && typeof bg.tileScale === "object") {
      bg.tileScale = { ...bg.tileScale };
    }
    clone.background = bg;
  }
  return clone;
}
