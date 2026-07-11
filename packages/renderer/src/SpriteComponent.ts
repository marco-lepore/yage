import { AssetHandle, serializable } from "@yagejs/core";
import { Sprite } from "pixi.js";
import { resolveTextureInput } from "./assets.js";
import type { DisplaySprite, TextureInput } from "./public-types.js";
import {
  VisualComponent,
  type VisualComponentData,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/** Options for creating a SpriteComponent. */
export interface SpriteComponentOptions extends VisualComponentOptions {
  /** Texture or texture key string. */
  texture: TextureInput;
  /** Anchor point (0-1). */
  anchor?: { x: number; y: number };
}

/** Serialisable snapshot of a SpriteComponent. */
export interface SpriteData extends VisualComponentData {
  textureKey: string | null;
  anchor?: { x: number; y: number };
}

/** Component that displays a PixiJS Sprite. */
@serializable
export class SpriteComponent extends VisualComponent {
  readonly sprite: DisplaySprite;
  private _textureKey: string | null;

  constructor(options: SpriteComponentOptions) {
    super(options.layer);
    this.sprite = Sprite.from(resolveTextureInput(options.texture));
    this._textureKey =
      typeof options.texture === "string"
        ? options.texture
        : options.texture instanceof AssetHandle
          ? options.texture.path
          : null;

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
  setTexture(texture: TextureInput): void {
    this._textureKey =
      typeof texture === "string"
        ? texture
        : texture instanceof AssetHandle
          ? texture.path
          : null;
    this.sprite.texture = resolveTextureInput(texture);
  }

  /** Serialise to a plain object for save/load. */
  serialize(): SpriteData | null {
    if (!this._textureKey) {
      console.warn(
        `SpriteComponent on "${this.entity?.name}": created with a Texture object. ` +
          `Use a string path or texture handle for save/load support.`,
      );
      return null;
    }
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
      texture: data.textureKey ?? "",
      layer: data.layer,
    };
    if (data.tint !== undefined) opts.tint = data.tint;
    if (data.alpha !== undefined) opts.alpha = data.alpha;
    if (data.anchor) opts.anchor = data.anchor;
    if (data.visible !== undefined) opts.visible = data.visible;
    if (data.interactive) opts.interactive = { ...data.interactive };
    return new SpriteComponent(opts);
  }
}
