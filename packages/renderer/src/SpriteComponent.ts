import { AssetHandle, Component, serializable } from "@yagejs/core";
import { Sprite } from "pixi.js";
import { RenderLayerManagerKey } from "./types.js";
import { resolveTextureInput } from "./assets.js";
import type { DisplaySprite, TextureInput } from "./public-types.js";

/** Options for creating a SpriteComponent. */
export interface SpriteComponentOptions {
  /** Texture or texture key string. */
  texture: TextureInput;
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

/** Serialisable snapshot of a SpriteComponent. */
export interface SpriteData {
  textureKey: string | null;
  layer: string;
  tint?: number;
  alpha?: number;
  anchor?: { x: number; y: number };
  visible?: boolean;
}

/** Component that displays a PixiJS Sprite. */
@serializable
export class SpriteComponent extends Component {
  readonly sprite: DisplaySprite;
  readonly layerName: string;
  private _textureKey: string | null;

  constructor(options: SpriteComponentOptions) {
    super();
    this.sprite = Sprite.from(resolveTextureInput(options.texture));
    this.layerName = options.layer ?? "default";
    this._textureKey =
      typeof options.texture === "string"
        ? options.texture
        : options.texture instanceof AssetHandle
          ? options.texture.path
          : null;

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
      textureKey: this._textureKey,
      layer: this.layerName,
      tint: this.sprite.tint,
      alpha: this.sprite.alpha,
      anchor: { x: this.sprite.anchor.x, y: this.sprite.anchor.y },
      visible: this.sprite.visible,
    };
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
    return new SpriteComponent(opts);
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
