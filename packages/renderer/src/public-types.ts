import type { AssetHandle } from "@yage/core";

/** A loaded texture resource managed by the renderer. */
export type TextureResource = import("pixi.js").Texture;

/** A typed asset handle for a texture resource. */
export type TextureHandle = AssetHandle<TextureResource>;

/** A typed handle for any asset loaded by the renderer asset pipeline. */
export type RendererAsset<T = unknown> = AssetHandle<T>;

/** Any texture reference accepted by renderer helpers and components. */
export type TextureInput = string | TextureResource | TextureHandle;

/** The mutable graphics drawing context used by renderer draw callbacks. */
export type GraphicsContext = import("pixi.js").Graphics;

/** A display container used by renderer and UI APIs. */
export type DisplayContainer = import("pixi.js").Container;

/** A sprite display object. */
export type DisplaySprite = import("pixi.js").Sprite;

/** Text styling accepted by UI and text APIs. */
export type TextStyle = import("pixi.js").TextStyleOptions;

/** Generic color input accepted by UI helpers. */
export type ColorValue = import("pixi.js").ColorSource;

/** Point-like data used by UI callbacks and options. */
export type PointLike = import("pixi.js").PointData;

/** Options for slicing a texture into frame textures. */
export interface TextureSliceOptions {
  frameWidth: number;
  frameHeight?: number;
  startX?: number;
  startY?: number;
  columns?: number;
  count?: number;
  gapX?: number;
  gapY?: number;
}
