import { Container, Sprite } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode, Unit } from "yoga-layout";
import type {
  DisplayContainer,
  DisplaySprite,
  TextureInput,
} from "@yagejs/renderer";
import { resolveTextureInput } from "@yagejs/renderer";
import type { UIImageProps } from "./types.js";
import { UIElementBase } from "./UIElementBase.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";
import { FocusOutline, layoutBox } from "./internal/focus-outline.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "./focus/pointer-request.js";

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
 *
 * The sprite sits inside a plain container, {@link UIImage.displayObject},
 * whose own space is measured in layout pixels. Layout stretches the sprite
 * inside it, so the element's `scale` and `rotation` stay the game's.
 */
export class UIImage extends UIElementBase {
  /** The sprite drawing the texture, stretched to the layout box. */
  readonly sprite: DisplaySprite;
  readonly displayObject: DisplayContainer;
  readonly yogaNode: YogaNode;

  private textureInput: TextureInput;
  private readonly pointerEvents: PointerEvents;
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;
  private _destroyed = false;

  constructor(props: UIImageProps) {
    super();
    this.yogaNode = createYogaNode();
    this.textureInput = props.texture;

    const texture = resolveTextureInput(this.textureInput);
    this.displayObject = new Container();
    this.sprite = new Sprite(texture);
    this.displayObject.addChild(this.sprite);
    // Pointer handlers and the consume mark sit on the sprite the pointer hits.
    applyConsumeInput(this.sprite, props.consumeInput);
    this.pointerEvents = new PointerEvents(this.sprite, props);

    // Out of focus navigation until a game asks for it with `focusable` —
    // which is what an inventory grid of picture cells does. Asked for, the
    // cell is outlined like every other focusable element; the pointer moves
    // focus here, which keeps the mouse and the keyboard on the same cell.
    this._focusOutline = new FocusOutline({
      container: this.displayObject,
      box: () => layoutBox(this.yogaNode),
    });
    this._focusOutline.set(props);
    this._focus = new FocusState(this, props, {
      focusableByDefault: false,
      paint: (focused) => this._focusOutline.setFocused(focused),
    });
    this.sprite.on("pointerover", () => {
      requestHoverFocus(this);
    });
    this.sprite.on("pointerdown", () => {
      requestPressFocus(this);
    });

    if (props.tint !== undefined) this.sprite.tint = props.tint;
    if (props.alpha !== undefined) this.sprite.alpha = props.alpha;

    // Yoga measure function — returns texture natural dimensions
    const sprite = this.sprite;
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
    this.applyTransformProps(props);
    this.syncAspectRatio();

    if (props.visible === false) {
      this.displayObject.visible = false;
      this.yogaNode.setDisplay(Display.None);
    }
  }

  /** Scale sprite to match Yoga computed size. */
  applyLayout(): void {
    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();
    this.sprite.width = w;
    this.sprite.height = h;
    this._focusOutline.refresh();
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
    const { width: texW, height: texH } = this.sprite.texture;
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
    return this.displayObject.visible;
  }

  set visible(v: boolean) {
    this.displayObject.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UIImageProps>): void {
    if (p.texture !== undefined && p.texture !== this.textureInput) {
      this.textureInput = p.texture;
      this.sprite.texture = resolveTextureInput(p.texture);
      this.yogaNode.markDirty();
    }

    if ("tint" in p) this.sprite.tint = p.tint ?? 0xffffff;
    if ("alpha" in p) this.sprite.alpha = p.alpha ?? 1;
    if ("consumeInput" in p) applyConsumeInput(this.sprite, p.consumeInput);
    this.pointerEvents.set(p);
    this._focus.set(p);
    this._focusOutline.set(p);

    applyLayoutProps(this.yogaNode, p);
    this.applyTransformProps(p);
    this.syncAspectRatio();

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /**
   * What the Inspector reports for this image: whether it takes part in
   * focus navigation, which is off unless the game asked for it, and whether
   * it holds focus right now. A test reads this instead of a screenshot.
   * @internal
   */
  _inspectState(): { focused: boolean; focusable: boolean } {
    return { focused: this._focus.focused, focusable: this._focus.focusable };
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._focus.destroy();
    this._focusOutline.destroy();
    clearConsumeInput(this.sprite);
    this.yogaNode.free();
    this.sprite.destroy();
    this.displayObject.destroy();
  }
}
