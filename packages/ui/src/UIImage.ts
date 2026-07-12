import { Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode } from "yoga-layout";
import type { AssetHandle } from "@yagejs/core";
import type { DisplayContainer, DisplaySprite } from "@yagejs/renderer";
import type { UIElement, UIImageProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { resolveTexture } from "./asset-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";

/** Displays a texture as a UI element, scaling to fit Yoga-computed dimensions. */
export class UIImage implements UIElement {
  readonly container: DisplaySprite;
  readonly yogaNode: YogaNode;

  get displayObject(): DisplayContainer {
    return this.container;
  }

  private textureHandle: AssetHandle<Texture>;
  private readonly pointerEvents: PointerEvents;
  private _destroyed = false;

  constructor(props: UIImageProps) {
    this.yogaNode = createYogaNode();
    this.textureHandle = props.texture;

    const texture = resolveTexture(this.textureHandle);
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
      const aspect = texH > 0 ? texW / texH : 1;

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

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UIImageProps>): void {
    if (p.texture !== undefined && p.texture !== this.textureHandle) {
      this.textureHandle = p.texture;
      this.container.texture = resolveTexture(p.texture);
      this.yogaNode.markDirty();
    }

    if ("tint" in p) this.container.tint = p.tint ?? 0xffffff;
    if ("alpha" in p) this.container.alpha = p.alpha ?? 1;
    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);
    this.pointerEvents.set(p);

    applyLayoutProps(this.yogaNode, p);

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
