import { NineSliceSprite } from "pixi.js";
import type { Container, Texture } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { AssetHandle } from "@yagejs/core";
import type { UIElement, UINineSliceProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { resolveTexture } from "./asset-helpers.js";

/** Displays a nine-slice texture as a UI element. Requires explicit width/height from layout. */
export class UINineSlice implements UIElement {
  readonly container: NineSliceSprite;
  readonly yogaNode: YogaNode;

  get displayObject(): Container {
    return this.container;
  }

  private textureHandle: AssetHandle<Texture>;

  constructor(props: UINineSliceProps) {
    this.yogaNode = createYogaNode();
    this.textureHandle = props.texture;

    const texture = resolveTexture(this.textureHandle);
    const insets = props.insets;

    if (typeof insets === "number") {
      this.container = new NineSliceSprite({
        texture,
        leftWidth: insets,
        topHeight: insets,
        rightWidth: insets,
        bottomHeight: insets,
      });
    } else {
      this.container = new NineSliceSprite({
        texture,
        leftWidth: insets.left,
        topHeight: insets.top,
        rightWidth: insets.right,
        bottomHeight: insets.bottom,
      });
    }

    if (props.tint !== undefined) this.container.tint = props.tint;
    if (props.alpha !== undefined) this.container.alpha = props.alpha;

    applyLayoutProps(this.yogaNode, props);

    if (props.visible === false) {
      this.container.visible = false;
      this.yogaNode.setDisplay(Display.None);
    }
  }

  /** Set sprite dimensions to match Yoga computed size. */
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
    const p = props as unknown as UINineSliceProps;

    if (p.texture !== undefined && p.texture !== this.textureHandle) {
      this.textureHandle = p.texture;
      this.container.texture = resolveTexture(p.texture);
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
