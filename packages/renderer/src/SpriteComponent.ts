import { Sprite } from "pixi.js";
import { resolveTextureInput } from "./assets.js";
import type { DisplaySprite, TextureRef } from "./public-types.js";
import {
  VisualComponent,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/** Options for creating a SpriteComponent. */
export interface SpriteComponentOptions extends VisualComponentOptions {
  /**
   * Texture asset key or typed handle. Runtime-created textures are
   * referenced by registering them under a key first (`registerTexture`).
   */
  texture: TextureRef;
  /** Anchor point (0-1). */
  anchor?: { x: number; y: number };
}

/** Component that displays a PixiJS Sprite. */
export class SpriteComponent extends VisualComponent {
  readonly sprite: DisplaySprite;

  constructor(options: SpriteComponentOptions) {
    super(options.layer);
    this.sprite = Sprite.from(resolveTextureInput(options.texture));
    if (options.anchor) {
      this.sprite.anchor.set(options.anchor.x, options.anchor.y);
    }
    this.applyVisualOptions(options);
  }

  /** The underlying Pixi display object. */
  get renderObject(): DisplaySprite {
    return this.sprite;
  }

  /** Replace the sprite's texture. */
  setTexture(texture: TextureRef): void {
    this.sprite.texture = resolveTextureInput(texture);
  }
}
