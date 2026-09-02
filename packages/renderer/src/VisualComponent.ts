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
import { EffectsHost } from "./effects/EffectsHost.js";
import { VisualModifierHost } from "./VisualModifiers.js";
import { attachMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle } from "./masks/MaskHandle.js";
import type {
  BlendMode,
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
   * How this object's pixels combine with what is drawn beneath it.
   * Default: `"inherit"` — the mode of the nearest ancestor that sets one,
   * which is `"normal"` unless a parent changed it. Set it explicitly to
   * `"normal"` inside a group that uses another mode. See {@link BlendMode}
   * for the modes that need `import "pixi.js/advanced-blend-modes"`.
   */
  blendMode?: BlendMode;
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
  /** The underlying Pixi display object. */
  abstract readonly renderObject: DisplayContainer;
  readonly layerName: string;
  /**
   * Component-scope effects host. `.fx.addEffect(...)` attaches a filter to
   * this component's render object; the effect is torn down automatically
   * when the entity or component is destroyed. `.fx.findEffect(definition)`
   * recovers the handle for the first matching effect.
   */
  readonly fx: EffectsHost;
  /**
   * Render-only transform, opacity, and visibility contributions. Modifiers
   * combine with the component's live base values and are never serialized.
   */
  readonly modifiers: VisualModifierHost;
  private _mask: MaskHandle | undefined;
  /**
   * The visibility the game asked for. The Pixi flag is this AND the
   * component being effectively enabled, so hiding a sprite by hand survives
   * a `setActive(false)` / `setActive(true)` cycle.
   */
  private _userVisible = true;
  /** The alpha requested by the game, before transient opacity modifiers. */
  private _userAlpha = 1;

  constructor(layer: string | undefined) {
    super();
    this.layerName = layer ?? "default";
    this.fx = new EffectsHost(
      () => this.renderObject,
      "component",
      () => makeEntityScopedQueue(this.entity),
    );
    this.modifiers = new VisualModifierHost(() => this.applyAppearance());
  }

  /**
   * Apply the shared visible/tint/alpha/interactive options to
   * `renderObject`. Call once from the subclass constructor, after the
   * concrete Pixi object is created.
   */
  protected applyVisualOptions(options: VisualComponentOptions): void {
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.tint !== undefined) this.renderObject.tint = options.tint;
    if (options.alpha !== undefined) this.alpha = options.alpha;
    if (options.blendMode !== undefined) {
      this.renderObject.blendMode = options.blendMode;
    }
    if (options.interactive) {
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
    this._userAlpha = alpha;
    this.applyAppearance();
  }

  /** Get the requested alpha before transient opacity modifiers. */
  get alpha(): number {
    return this._userAlpha;
  }

  /** Set how the container combines with what is drawn beneath it. */
  set blendMode(mode: BlendMode) {
    this.renderObject.blendMode = mode;
  }

  /** Get the container's blend mode. */
  get blendMode(): BlendMode {
    return this.renderObject.blendMode;
  }

  /**
   * Set the container's visibility. Written while the entity is dormant, it
   * is remembered and applied when the entity is activated.
   */
  set visible(value: boolean) {
    this._userVisible = value;
    this.applyAppearance();
  }

  /** Get the requested visibility, whatever the entity's activeness. */
  get visible(): boolean {
    return this._userVisible;
  }

  /**
   * Attach a mask to this component's render object, replacing any existing
   * mask. Returns a handle for inverse toggling, redraw (graphicsMask), or
   * removal. The mask is torn down automatically when the component is
   * destroyed.
   */
  setMask(factory: MaskFactory): MaskHandle {
    this._mask?.remove();
    this._mask = attachMask(this.renderObject, factory, this);
    return this._mask;
  }

  /** Detach and destroy the current mask, if any. */
  clearMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /** The currently attached mask handle, if any. */
  get mask(): MaskHandle | undefined {
    return this._mask;
  }

  /**
   * Derived render facet for the Inspector — world-space `bounds` and the
   * component's own (local, non-inherited) `visible` flag, computed on
   * demand from the live render object. See {@link computeRenderFacet} for
   * the bounds coordinate space.
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
    this.applyAppearance();
  }

  onDisable(): void {
    this.renderObject.visible = false;
  }

  onDestroy(): void {
    unmarkPointerConsumeContainer(this.renderObject);
    this.modifiers._destroy();
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

  /** Apply the final alpha after transient modifiers. */
  protected applyEffectiveAlpha(alpha: number): void {
    this.renderObject.alpha = alpha;
  }

  private applyAppearance(): void {
    this.applyEffectiveAlpha(this._userAlpha * this.modifiers.opacityFactor);
    this.renderObject.visible =
      this._userVisible && this.effectiveEnabled && this.modifiers.visible;
  }
}
