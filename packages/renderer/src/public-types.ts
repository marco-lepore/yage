import type { AssetHandle } from "@yagejs/core";
import type {
  ColorSource,
  Container,
  FillGradient,
  Graphics,
  PointData,
  Sprite,
  Text,
  Texture,
  TextStyleOptions,
} from "pixi.js";

/** A loaded texture resource managed by the renderer. */
export type TextureResource = Texture;

/** A typed asset handle for a texture resource. */
export type TextureHandle = AssetHandle<TextureResource>;

/** A typed handle for any asset loaded by the renderer asset pipeline. */
export type RendererAsset<T = unknown> = AssetHandle<T>;

/** Any texture reference accepted by renderer helpers and components. */
export type TextureInput = string | TextureResource | TextureHandle;

/** The mutable graphics drawing context used by renderer draw callbacks. */
export type GraphicsContext = Graphics;

/** A display container used by renderer and UI APIs. */
export type DisplayContainer = Container;

/** A sprite display object. */
export type DisplaySprite = Sprite;

/** A text display object. */
export type DisplayText = Text;

/** Text styling accepted by UI and text APIs. */
export type TextStyle = TextStyleOptions;

/** A gradient fill usable anywhere a PixiJS fill style is accepted. */
export type GradientFill = FillGradient;

/** Generic color input accepted by UI helpers. */
export type ColorValue = ColorSource;

/** Point-like data used by UI callbacks and options. */
export type PointLike = PointData;

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
