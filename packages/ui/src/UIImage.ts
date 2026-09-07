import { Sprite } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode, Unit } from "yoga-layout";
import type {
  DisplayContainer,
  DisplaySprite,
  TextureInput,
} from "@yagejs/renderer";
import { resolveTextureInput } from "@yagejs/renderer";
import type { UIElement, UIImageProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";

/** A dimension the caller sized. `auto` and unset leave the size to layout. */
function isSizedDimension(value: { readonly unit: Unit }): boolean {
  return value.unit === Unit.Point || value.unit === Unit.Percent;
}

/**
 * Displays a texture as a UI element.
 *
 * Size it on one axis and the other follows the texture's aspect ratio, even
 * where a flex parent would stretch it. Size both axes and the texture
 * stretches to that box. Size neither and it measures at the texture's own
 * pixel size, and its parent can stretch it like any other flex child. A
 * `flexGrow`, `flex` or `flexBasis` sizes the main axis as well, so with one
 * of those set the texture stretches as if both axes were sized.
 */
export class UIImage implements UIElement {
  readonly container: DisplaySprite;
  readonly yogaNode: YogaNode;

  get displayObject(): DisplayContainer {
    return this.container;
  }

  private textureInput: TextureInput;
  private readonly pointerEvents: PointerEvents;
  private _destroyed = false;

  constructor(props: UIImageProps) {
    this.yogaNode = createYogaNode();
    this.textureInput = props.texture;

    const texture = resolveTextureInput(this.textureInput);
    this.container = new Sprite(texture);
    applyConsumeInput(this.container, props.consumeInput);
    this.pointerEvents = new PointerEvents(this.container, props);

    if (props.tint !== undefined) this.container.tint = props.tint;
    if (props.alpha !== undefined) this.container.alpha = props.alpha;

    // Yoga measure function — returns texture natural dimensions
    const sprite = this.container;
    this.yogaNode.setMeasureFunc((width, widthMode, height, heightMode) => {
      const texW = sprite.texture.width;
      const texH = sprite.texture.height;
      const aspect = texW > 0 && texH > 0 ? texW / texH : 1;

      let measuredWidth = texW;
      let measuredHeight = texH;

      if (widthMode === MeasureMode.Exactly) {
        measuredWidth = width;
        measuredHeight = measuredWidth / aspect;
      } else if (widthMode === MeasureMode.AtMost) {
        measuredWidth = Math.min(texW, width);
        measuredHeight = measuredWidth / aspect;
      }

      if (heightMode === MeasureMode.Exactly) {
        measuredHeight = height;
      } else if (heightMode === MeasureMode.AtMost) {
        measuredHeight = Math.min(measuredHeight, height);
      }

      return { width: measuredWidth, height: measuredHeight };
    });

    applyLayoutProps(this.yogaNode, props);
    this.syncAspectRatio();

    if (props.visible === false) {
      this.container.visible = false;
      this.yogaNode.setDisplay(Display.None);
    }
  }

  /** Scale sprite to match Yoga computed size. */
  applyLayout(): void {
    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();
    this.container.width = w;
    this.container.height = h;
  }

  /**
   * Give Yoga the texture's aspect ratio when exactly one of `width` /
   * `height` is sized, so the other dimension follows the picture — including
   * where a flex parent would otherwise stretch the element. Cleared when both
   * are sized (the caller asked for that box) and when neither is (the element
   * measures at the texture's own size). Also cleared when `flexGrow` or a
   * definite `flexBasis` sizes the main axis: the node cannot tell which axis
   * its parent lays out along, and a ratio applied against a flex-sized main
   * axis discards the dimension the caller did set.
   */
  private syncAspectRatio(): void {
    const { width: texW, height: texH } = this.container.texture;
    const widthSized = isSizedDimension(this.yogaNode.getWidth());
    const heightSized = isSizedDimension(this.yogaNode.getHeight());
    const flexSized =
      this.yogaNode.getFlexGrow() > 0 ||
      isSizedDimension(this.yogaNode.getFlexBasis());
    const derives =
      widthSized !== heightSized && !flexSized && texW > 0 && texH > 0;
    this.yogaNode.setAspectRatio(derives ? texW / texH : undefined);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UIImageProps>): void {
    if (p.texture !== undefined && p.texture !== this.textureInput) {
      this.textureInput = p.texture;
      this.container.texture = resolveTextureInput(p.texture);
      this.yogaNode.markDirty();
    }

    if ("tint" in p) this.container.tint = p.tint ?? 0xffffff;
    if ("alpha" in p) this.container.alpha = p.alpha ?? 1;
    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);
    this.pointerEvents.set(p);

    applyLayoutProps(this.yogaNode, p);
    this.syncAspectRatio();

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    clearConsumeInput(this.container);
    this.yogaNode.free();
    this.container.destroy();
  }
}
