import { Sprite } from "pixi.js";
import type { Container, Texture } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode } from "yoga-layout";
import type { AssetHandle } from "@yage/core";
import type { UIElement, UIImageProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { resolveTexture } from "./asset-helpers.js";

/** Displays a texture as a UI element, scaling to fit Yoga-computed dimensions. */
export class UIImage implements UIElement {
  readonly container: Sprite;
  readonly yogaNode: YogaNode;

  get displayObject(): Container {
    return this.container;
  }

  private textureHandle: AssetHandle<Texture>;

  constructor(props: UIImageProps) {
    this.yogaNode = createYogaNode();
    this.textureHandle = props.texture;

    const texture = resolveTexture(this.textureHandle);
    this.container = new Sprite(texture);

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

  update(props: Record<string, unknown>): void {
    const p = props as unknown as UIImageProps;

    if (p.texture !== undefined && p.texture !== this.textureHandle) {
      this.textureHandle = p.texture;
      this.container.texture = resolveTexture(p.texture);
      this.yogaNode.markDirty();
    }

    if (p.tint !== undefined) this.container.tint = p.tint;
    if (p.alpha !== undefined) this.container.alpha = p.alpha;

    applyLayoutProps(this.yogaNode, p);

    if (p.visible !== undefined) {
      this.visible = p.visible;
    }
  }

  destroy(): void {
    this.yogaNode.free();
    this.container.destroy();
  }
}
