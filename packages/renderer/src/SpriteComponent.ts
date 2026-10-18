import { MaterialVisualComponent } from "./materials/MaterialVisualComponent.js";
import { resolveMaps } from "./materials/resolveMaps.js";
import type { SpriteMaps, SpriteMaterial } from "./materials.js";
import { Sprite } from "pixi.js";
import { resolveTextureInput } from "./assets.js";
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
  /** Reusable surface settings. Omit for ordinary unlit drawing. */
  material?: SpriteMaterial;
  /** Anchor point (0-1). */
  anchor?: { x: number; y: number };
}

/** Component that displays a PixiJS Sprite. */
export class SpriteComponent extends MaterialVisualComponent {
  readonly sprite: DisplaySprite;

  constructor(options: SpriteComponentOptions) {
    super(options.layer);
    const texture = resolveTextureInput(options.texture);
    const maps = resolveMaps([texture], options.maps);
    this.sprite = Sprite.from(texture);
    this.initializeMaterial(maps, options.material);
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
  setTexture(texture: TextureRef, maps?: SpriteMaps): void {
    const resolved = resolveTextureInput(texture);
    const companions = resolveMaps([resolved], maps);
    this.surface.setMaps(companions, this.layerName);
    this.sprite.texture = resolved;
  }
}
