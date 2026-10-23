import { MaterialVisualComponent } from "./materials/MaterialVisualComponent.js";
import { resolveMaps } from "./materials/resolveMaps.js";
import type { SpriteMaps, SpriteMaterial } from "./materials.js";
import type { Vec2Like } from "@yagejs/core";
import { Sprite } from "pixi.js";
import { resolveTextureInput } from "./assets.js";
import { readPoint, writePoint } from "./internal/point.js";
import type { DisplaySprite, TextureRef } from "./public-types.js";
import { type VisualComponentOptions } from "./VisualComponent.js";

/** Options for creating a SpriteComponent. */
export interface SpriteComponentOptions extends VisualComponentOptions {
  /**
   * Texture asset key or typed handle. Runtime-created textures are
   * referenced by registering them under a key first (`registerTexture`).
   */
  texture: TextureRef;
  /** Companion images with the same page dimensions and UV layout. */
  maps?: SpriteMaps;
  /**
   * Reusable shading settings. Omit to follow the scene: lit on a world layer
   * of a `surfaceLighting()` scene, ordinary drawing everywhere else.
   */
  material?: SpriteMaterial;
  /** Anchor point (0-1). See {@link SpriteComponent.anchor}. */
  anchor?: Vec2Like;
}

/** Component that displays a PixiJS Sprite. */
export class SpriteComponent extends MaterialVisualComponent {
  private readonly _sprite: DisplaySprite;

  constructor(options: SpriteComponentOptions) {
    super(options.layer);
    const texture = resolveTextureInput(options.texture);
    const maps = resolveMaps([texture], options.maps);
    this._sprite = Sprite.from(texture);
    this.initializeMaterial(maps, options.material);
    if (options.anchor) {
      writePoint(
        "SpriteComponent.constructor",
        "anchor",
        this._sprite.anchor,
        options.anchor,
      );
    }
    this.applyVisualOptions(options);
  }

  /**
   * The Pixi object this component draws with. Change the visual through the
   * component; see `VisualComponent.renderObject`.
   */
  get renderObject(): DisplaySprite {
    return this._sprite;
  }

  /**
   * The point of the texture that sits on the entity position, as a fraction
   * of the texture's size: `{ x: 0, y: 0 }` (the default) is the top-left
   * corner and `{ x: 0.5, y: 0.5 }` the centre. Rotation and scale turn the
   * sprite about it. Each read returns a new object; a non-finite coordinate
   * throws.
   */
  get anchor(): Vec2Like {
    return readPoint(this._sprite.anchor);
  }

  set anchor(value: Vec2Like) {
    writePoint("SpriteComponent.anchor", "anchor", this._sprite.anchor, value);
  }

  /** Replace the sprite's texture and its whole map set. Omitted maps are cleared. */
  setTexture(texture: TextureRef, maps?: SpriteMaps): void {
    const resolved = resolveTextureInput(texture);
    const companions = resolveMaps([resolved], maps);
    this.binding.setMaps(companions, this.layerName);
    this._sprite.texture = resolved;
  }
}
