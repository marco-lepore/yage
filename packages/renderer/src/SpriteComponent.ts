import { Component } from "@yage/core";
import { Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
import { RenderLayerManagerKey } from "./types.js";

/** Options for creating a SpriteComponent. */
export interface SpriteComponentOptions {
  /** Texture or texture key string. */
  texture: Texture | string;
  /** Anchor point (0-1). */
  anchor?: { x: number; y: number };
  /** Render layer name. Default: "default". */
  layer?: string;
  /** Initial visibility. Default: true. */
  visible?: boolean;
  /** Tint color. */
  tint?: number;
  /** Alpha (opacity). Default: 1. */
  alpha?: number;
}

/** Component that displays a PixiJS Sprite. */
export class SpriteComponent extends Component {
  readonly sprite: Sprite;
  readonly layerName: string;

  constructor(options: SpriteComponentOptions) {
    super();
    this.sprite = Sprite.from(options.texture as Texture);
    this.layerName = options.layer ?? "default";

    if (options.anchor) {
      this.sprite.anchor.set(options.anchor.x, options.anchor.y);
    }
    if (options.visible !== undefined) {
      this.sprite.visible = options.visible;
    }
    if (options.tint !== undefined) {
      this.sprite.tint = options.tint;
    }
    if (options.alpha !== undefined) {
      this.sprite.alpha = options.alpha;
    }
  }

  /** Replace the sprite's texture. Accepts a texture key string or Texture object. */
  setTexture(texture: Texture | string): void {
    this.sprite.texture = typeof texture === "string"
      ? Sprite.from(texture).texture
      : texture;
  }

  /** Set the sprite's tint color. */
  set tint(color: number) {
    this.sprite.tint = color;
  }

  /** Get the sprite's tint color. */
  get tint(): number {
    return this.sprite.tint;
  }

  /** Set the sprite's alpha (opacity). */
  set alpha(alpha: number) {
    this.sprite.alpha = alpha;
  }

  /** Get the sprite's alpha (opacity). */
  get alpha(): number {
    return this.sprite.alpha;
  }

  onAdd(): void {
    const layers = this.use(RenderLayerManagerKey);
    const layer = layers.get(this.layerName);
    layer.container.addChild(this.sprite);
  }

  onDestroy(): void {
    this.sprite.removeFromParent();
    this.sprite.destroy();
  }
}
