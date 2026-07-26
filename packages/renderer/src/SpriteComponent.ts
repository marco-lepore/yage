import { serializable } from "@yagejs/core";
import { Sprite } from "pixi.js";
import { resolveTextureInput } from "./assets.js";
import type { DisplaySprite, TextureRef } from "./public-types.js";
import {
  VisualComponent,
  visualOptionsFromData,
  type VisualComponentData,
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

/** Serialisable snapshot of a SpriteComponent. */
export interface SpriteData extends VisualComponentData {
  textureKey: string;
  anchor?: { x: number; y: number };
}

/** Component that displays a PixiJS Sprite. */
@serializable
export class SpriteComponent extends VisualComponent {
  readonly sprite: DisplaySprite;
  private _textureKey: string;

  constructor(options: SpriteComponentOptions) {
    super(options.layer);
    this.sprite = Sprite.from(resolveTextureInput(options.texture));
    this._textureKey =
      typeof options.texture === "string"
        ? options.texture
        : options.texture.path;

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
    this._textureKey =
      typeof texture === "string" ? texture : texture.path;
    this.sprite.texture = resolveTextureInput(texture);
  }

  /** Serialise to a plain object for save/load. */
  serialize(): SpriteData {
    return {
      ...this.serializeVisual(),
      textureKey: this._textureKey,
      anchor: { x: this.sprite.anchor.x, y: this.sprite.anchor.y },
    };
  }

  /** Restore effects and mask after the sprite is parented in the scene tree. */
  afterRestore(data: SpriteData): void {
    this.restoreVisual(data);
  }

  /** Create a SpriteComponent from a serialised snapshot. */
  static fromSnapshot(data: SpriteData): SpriteComponent {
    const opts: SpriteComponentOptions = {
      ...visualOptionsFromData(data),
      texture: data.textureKey,
    };
    if (data.anchor) opts.anchor = data.anchor;
    return new SpriteComponent(opts);
  }
}
