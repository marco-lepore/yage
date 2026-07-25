import {
  Component,
  makeEntityScopedQueue,
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
} from "@yagejs/core";
import { computeRenderFacet } from "./internal/renderFacet.js";
import type { RenderFacetSnapshot } from "./internal/renderFacet.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import { resolveRenderParent } from "./SortGroupComponent.js";
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { attachMask, reattachMaskFromSnapshot } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";
import type {
  ColorValue,
  DestroyOptions,
  DisplayContainer,
} from "./public-types.js";

/**
 * Pixi event-mode + pointer-consume config shared by every visual
 * component's `interactive` option.
 */
export interface VisualInteractiveOptions {
  /**
   * Pixi event mode. Defaults to `"static"` when the option object is set
   * (interactive, no children-recurse cost). Pass `"dynamic"` for Pixi
   * behavior where event-mode propagates to children automatically.
   */
  eventMode?: "static" | "dynamic";
  /** When `true`, claim pointer events landing on this container. Default `false`. */
  consumeOnInteraction?: boolean;
}

/** Options shared by all five visual components. */
export interface VisualComponentOptions {
  /** Render layer name. Default: "default". */
  layer?: string;
  /** Initial visibility. Default: true. */
  visible?: boolean;
  /** Tint color. */
  tint?: ColorValue;
  /** Alpha (opacity). Default: 1. */
  alpha?: number;
  /**
   * Make the container interactive. When set, Pixi `eventMode` is configured
   * so it participates in pointer hit-testing — required for any
   * `.on("pointerdown", ...)` listener to fire.
   *
   * `consumeOnInteraction: true` additionally marks it as a UI-input surface
   * (via `@yagejs/core`'s consume registry), so a `pointerdown` landing on it
   * is auto-claimed by `@yagejs/input` — preventing the same press from also
   * firing gameplay action-map edges like `MouseLeft`. Default `false`: an
   * interactive container still propagates the action, matching the "I want
   * both Pixi events AND the action map" use case.
   */
  interactive?: VisualInteractiveOptions;
}

/** Snapshot fields shared by all five visual components. */
export interface VisualComponentData {
  layer: string;
  tint?: ColorValue;
  alpha?: number;
  visible?: boolean;
  /**
   * See {@link VisualComponentOptions.interactive} — persisted so restored
   * scenes keep `eventMode` and the `consumeOnInteraction` mark on the
   * rebuilt container.
   */
  interactive?: VisualInteractiveOptions;
  effects?: EffectStackSnapshot;
  mask?: MaskSnapshot;
}

/**
 * Shared base for the renderer's five visual components (Sprite,
 * AnimatedSprite, Graphics, Text, SplitText). Carries the render-layer field,
 * lazy effects host, mask lifecycle, scene-tree parenting, and the generic
 * visible/tint/alpha/interactive vocabulary — every underlying Pixi display
 * object supports all four directly on `Container`, so this operates on
 * `renderObject` rather than each subclass re-deriving the same three-liner.
 *
 * Subclasses provide `renderObject` (their concrete Pixi display object,
 * created in their own constructor) and call {@link applyVisualOptions} once
 * it exists — options can't be applied during `VisualComponent`'s own
 * constructor since `renderObject` isn't assigned yet at that point.
 */
export abstract class VisualComponent extends Component {
  // Inherited by every visual subclass.
  static restorePriority = 30;

  /** The underlying Pixi display object. */
  abstract readonly renderObject: DisplayContainer;
  readonly layerName: string;
  /**
   * Component-scope effects host. `.fx.addEffect(...)` attaches a filter to
   * this component's render object; the effect is torn down automatically
   * when the entity or component is destroyed. `.fx.findEffect(definition)`
   * recovers the handle for the first matching effect after save/load.
   */
  readonly fx: EffectsHost;
  private _mask: MaskHandle | undefined;
  private _interactive: VisualInteractiveOptions | undefined;
  /**
   * The visibility the game asked for. The Pixi flag is this AND the
   * component being effectively enabled, so hiding a sprite by hand survives
   * a `setActive(false)` / `setActive(true)` cycle and a snapshot taken while
   * the entity is dormant still records the game's value.
   */
  private _userVisible = true;

  constructor(layer: string | undefined) {
    super();
    this.layerName = layer ?? "default";
    this.fx = new EffectsHost(
      () => this.renderObject,
      "component",
      () => makeEntityScopedQueue(this.entity),
    );
  }

  /**
   * Apply the shared visible/tint/alpha/interactive options to
   * `renderObject`. Call once from the subclass constructor, after the
   * concrete Pixi object is created.
   */
  protected applyVisualOptions(options: VisualComponentOptions): void {
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.tint !== undefined) this.renderObject.tint = options.tint;
    if (options.alpha !== undefined) this.renderObject.alpha = options.alpha;
    if (options.interactive) {
      this._interactive = { ...options.interactive };
      this.renderObject.eventMode = options.interactive.eventMode ?? "static";
      if (options.interactive.consumeOnInteraction) {
        markPointerConsumeContainer(this.renderObject);
      }
    }
  }

  /** Set the container's tint color. */
  set tint(color: ColorValue) {
    this.renderObject.tint = color;
  }

  /** Get the container's tint color. */
  get tint(): number {
    return this.renderObject.tint;
  }

  /** Set the container's alpha (opacity). */
  set alpha(alpha: number) {
    this.renderObject.alpha = alpha;
  }

  /** Get the container's alpha (opacity). */
  get alpha(): number {
    return this.renderObject.alpha;
  }

  /**
   * Set the container's visibility. Written while the entity is dormant, it
   * is remembered and applied when the entity is activated.
   */
  set visible(value: boolean) {
    this._userVisible = value;
    this.renderObject.visible = value && this.effectiveEnabled;
  }

  /** Get the requested visibility, whatever the entity's activeness. */
  get visible(): boolean {
    return this._userVisible;
  }

  /**
   * Serialise the shared layer/visible/tint/alpha/interactive/effects/mask
   * fields. Subclasses spread this into their own `Data` object alongside
   * their own-specific fields (texture key, text, anchor, ...).
   */
  protected serializeVisual(): VisualComponentData {
    const data: VisualComponentData = {
      layer: this.layerName,
      tint: this.renderObject.tint,
      alpha: this.renderObject.alpha,
      visible: this._userVisible,
    };
    if (this._interactive) data.interactive = { ...this._interactive };
    const effects = this.fx.serialize();
    if (effects) data.effects = effects;
    const mask = this._mask?.serialize();
    if (mask) data.mask = mask;
    return data;
  }

  /**
   * Restore effects and mask from a snapshot's shared fields. Call from the
   * subclass's `afterRestore`, after the render object is parented.
   */
  protected restoreVisual(
    data: Pick<VisualComponentData, "effects" | "mask">,
  ): void {
    if (data.effects) this.fx.restore(data.effects);
    if (data.mask) {
      this._mask = reattachMaskFromSnapshot(
        this._mask,
        this.renderObject,
        data.mask,
      );
    }
  }

  /**
   * Attach a mask to this component's render object, replacing any existing
   * mask. Returns a handle for inverse toggling, redraw (graphicsMask), or
   * removal. The mask is torn down automatically when the component is
   * destroyed.
   */
  setMask(factory: MaskFactory): MaskHandle {
    this._mask?.remove();
    this._mask = attachMask(this.renderObject, factory);
    return this._mask;
  }

  /** Detach and destroy the current mask, if any. */
  clearMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /**
   * The currently attached mask handle, if any. Useful after save/load to
   * recover a handle whose caller-side reference went stale.
   */
  get mask(): MaskHandle | undefined {
    return this._mask;
  }

  /**
   * Derived render facet for the Inspector — world-space `bounds` and the
   * component's own (local, non-inherited) `visible` flag, computed on
   * demand from the live render object. Not part of `serialize()`; see
   * {@link computeRenderFacet} for the bounds coordinate space.
   */
  inspectRender(): RenderFacetSnapshot {
    return computeRenderFacet(this.renderObject);
  }

  onAdd(): void {
    const tree = this.use(SceneRenderTreeKey);
    resolveRenderParent(this.entity, this.layerName, tree).addChild(
      this.renderObject,
    );
    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity. Start hidden so a
    // component added to a dormant entity doesn't inherit Pixi's
    // visible-by-default and show before it should.
    this.renderObject.visible = false;
  }

  onEnable(): void {
    this.renderObject.visible = this._userVisible;
  }

  onDisable(): void {
    this.renderObject.visible = false;
  }

  onDestroy(): void {
    unmarkPointerConsumeContainer(this.renderObject);
    this.fx.destroy();
    this._mask?.remove();
    this.renderObject.removeFromParent();
    this.renderObject.destroy(this.destroyOptions());
  }

  /**
   * Pixi destroy options passed to `renderObject.destroy()`. Default:
   * `undefined` (Pixi's own defaults). Override for a component whose
   * destroy must cascade to children (SplitText's per-segment display
   * objects).
   */
  protected destroyOptions(): DestroyOptions | undefined {
    return undefined;
  }
}
